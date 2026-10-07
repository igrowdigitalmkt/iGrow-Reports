import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordInboxMessage } from "@/modules/whatsapp/inbox-store";
import { MAX_REPLY_FILE_BYTES, MAX_REPLY_TEXT, replyMediaKind, replyWindow } from "@/modules/whatsapp/reply-rules";
import { sendOfficialReply, WhatsAppSetupError } from "@/modules/whatsapp/server";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
import { sendQrReply } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

/**
 * Sends a reply (text, or one file with an optional caption) from the conversation's number.
 * The conversation is read with the member's own access rules first: no access, no send.
 */
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const id = z.uuid().safeParse((await params).conversationId);
  const form = await request.formData().catch(() => null);
  if (!id.success || !form) return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
  const text = String(form.get("text") ?? "").trim();
  const file = form.get("file");
  if (text.length > MAX_REPLY_TEXT) return Response.json({ error: "A mensagem passou de 4.096 caracteres." }, { status: 400, headers });
  if (!text && !(file instanceof Blob)) return Response.json({ error: "Escreva uma mensagem ou escolha um arquivo." }, { status: 400, headers });
  if (file instanceof Blob && (file.size === 0 || file.size > MAX_REPLY_FILE_BYTES)) return Response.json({ error: "O arquivo precisa ter até 4 MB." }, { status: 400, headers });

  const context = await requireAgencyContext();
  if (context.role === "viewer") return Response.json({ error: "Seu perfil só pode consultar as conversas." }, { status: 403, headers });
  const { data: conversation } = await context.supabase.from("whatsapp_conversations").select("*").eq("agency_id", context.agency.id).eq("id", id.data).maybeSingle();
  if (!conversation) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Envio indisponível neste ambiente." }, { status: 503, headers });

  if (!replyWindow(conversation.channel, conversation.last_inbound_at, new Date()).open) {
    return Response.json({ error: "Passaram mais de 24 horas desde a última mensagem do cliente. Pela API oficial, só uma mensagem modelo retoma a conversa." }, { status: 409, headers });
  }
  const filename = file instanceof File && file.name ? file.name.slice(0, 200) : "arquivo";
  const mime = file instanceof Blob ? file.type || "application/octet-stream" : "";
  const kind = file instanceof Blob ? replyMediaKind(mime, conversation.channel) : null;
  if (file instanceof Blob && !kind) return Response.json({ error: "Esse tipo de arquivo não é aceito pelo WhatsApp." }, { status: 400, headers });

  try {
    const sent = conversation.channel === "qr"
      ? { externalId: await sendQrReply(context.agency.id, conversation.remote_id, file instanceof Blob
        ? { base64: Buffer.from(await file.arrayBuffer()).toString("base64"), filename, mime, kind: kind!, caption: text || undefined }
        : { text }), mediaId: null }
      : await sendOfficialReply(service, { agencyId: context.agency.id, connectionId: conversation.whatsapp_connection_id!, to: conversation.remote_id,
        content: file instanceof Blob ? { file, filename, mime, kind: kind!, caption: text || undefined } : { text } });
    // Recorded right away so it shows without waiting for the webhook (same id: no duplicate).
    await recordInboxMessage(service, { agencyId: context.agency.id, connectionId: conversation.whatsapp_connection_id, message: {
      remoteId: conversation.remote_id, isGroup: conversation.is_group, title: null, author: null,
      externalId: sent.externalId ?? `igrow-${crypto.randomUUID()}`, direction: "out", kind: kind ?? "text",
      body: text || null, mediaName: kind === "document" ? filename : null, mediaMime: mime || null, sentAt: new Date().toISOString(), mediaId: sent.mediaId,
    } });
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const message = error instanceof WhatsAppSetupError || error instanceof EvolutionError ? error.message : "Não foi possível enviar agora. Tente de novo.";
    return Response.json({ error: message }, { status: 502, headers });
  }
}
