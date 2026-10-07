import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { recordInboxMessage } from "@/modules/whatsapp/inbox-store";
import { MAX_REPLY_TEXT } from "@/modules/whatsapp/reply-rules";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
import { normalizePairingPhone } from "@/modules/whatsapp-qr/format";
import { sendQrReply } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

/**
 * Starts a conversation from the QR Code session with a first text message. Official numbers can
 * only start conversations with an approved template, so they are not handled here.
 */
export async function POST(request: Request) {
  const body = z.object({
    phone: z.string().trim().min(8).max(24),
    name: z.string().trim().max(200).optional(),
    text: z.string().trim().min(1, "Escreva a primeira mensagem.").max(MAX_REPLY_TEXT),
  }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: body.error.issues[0]?.message ?? "Pedido inválido." }, { status: 400, headers });
  const phone = normalizePairingPhone(body.data.phone);
  if (!phone) return Response.json({ error: "Informe o número com DDD, por exemplo (86) 99999-9999." }, { status: 400, headers });

  const context = await requireAgencyContext();
  if (context.role === "viewer") return Response.json({ error: "Seu perfil só pode consultar as conversas." }, { status: 403, headers });
  const modules = context.role === "owner" || context.role === "admin" ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  if (!canOpenSection(context.role, modules, "whatsapp")) return Response.json({ error: "A área WhatsApp não está liberada para você." }, { status: 403, headers });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Envio indisponível neste ambiente." }, { status: 503, headers });

  try {
    const externalId = await sendQrReply(context.agency.id, phone, { text: body.data.text });
    const row = await recordInboxMessage(service, { agencyId: context.agency.id, connectionId: null, message: {
      remoteId: phone, isGroup: false, title: body.data.name || null, author: null, externalId: externalId ?? `igrow-${crypto.randomUUID()}`,
      direction: "out", kind: "text", body: body.data.text, mediaName: null, mediaMime: null, sentAt: new Date().toISOString(),
    } });
    return Response.json({ ok: true, conversationId: row?.conversation_id ?? null }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof EvolutionError ? error.message : "Não foi possível enviar agora. Tente de novo." }, { status: 502, headers });
  }
}
