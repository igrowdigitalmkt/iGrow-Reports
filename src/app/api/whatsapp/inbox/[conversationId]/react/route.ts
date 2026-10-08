import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordInboxReaction } from "@/modules/whatsapp/inbox-store";
import { sendQrReaction } from "@/modules/whatsapp-qr/server";
import { sendOfficialReaction, WhatsAppSetupError } from "@/modules/whatsapp/server";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
import { replyWindow } from "@/modules/whatsapp/reply-rules";
import { WHATSAPP_QR_RECENT_DAYS } from "@/modules/whatsapp/recent-policy";

export const runtime = "nodejs";
export const maxDuration = 45;
const headers = { "Cache-Control": "private, no-store" };

function validEmoji(emoji: string) {
  if (!emoji) return true; // Removing a reaction uses an empty string.
  if (emoji.length > 32 || /[\r\n]/.test(emoji)) return false;
  // A reaction is ONE displayed grapheme cluster, not an arbitrary chat text.
  return [...new Intl.Segmenter("pt-BR", { granularity: "grapheme" }).segment(emoji)].length === 1;
}

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const id = z.uuid().safeParse((await params).conversationId);
  const body = z.object({ messageId: z.uuid(), emoji: z.string().max(32) })
    .safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success || !validEmoji(body.data.emoji))
    return Response.json({ error: "Escolha apenas um emoji de reação." }, { status: 400, headers });
  const context = await requireAgencyContext();
  if (context.role === "viewer")
    return Response.json({ error: "Seu perfil só pode consultar as mensagens." }, { status: 403, headers });
  const { data: conversation, error: chatError } = await context.supabase.from("whatsapp_conversations")
    .select("id,remote_id,channel,whatsapp_connection_id,last_inbound_at")
    .eq("agency_id", context.agency.id).eq("id", id.data).maybeSingle();
  if (chatError || !conversation) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  const { data: original, error: messageError } = await context.supabase.from("whatsapp_messages")
    .select("external_id,direction,sent_at,participant_jid,revoked_at").eq("agency_id", context.agency.id)
    .eq("conversation_id", conversation.id).eq("id", body.data.messageId).maybeSingle();
  if (messageError || !original?.external_id || original.external_id.startsWith("igrow-"))
    return Response.json({ error: "Esta mensagem não tem identificação válida para reação." }, { status: 409, headers });
  if (original.revoked_at) return Response.json({ error: "Mensagem já apagada." }, { status: 409, headers });
  if (conversation.channel === "qr" && Date.parse(original.sent_at) < Date.now() - WHATSAPP_QR_RECENT_DAYS * 86_400_000)
    return Response.json({ error: "A mensagem saiu da janela recente de consulta." }, { status: 409, headers });
  if (conversation.channel === "official" && !replyWindow("official", conversation.last_inbound_at, new Date()).open)
    return Response.json({ error: "A janela de 24 horas deste contato está encerrada." }, { status: 409, headers });
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Integração indisponível." }, { status: 503, headers });
  try {
    if (conversation.channel === "qr") {
      await sendQrReaction(context.agency.id, conversation.remote_id, {
        externalId: original.external_id, fromMe: original.direction === "out", participant: original.participant_jid,
      }, body.data.emoji);
    } else if (conversation.whatsapp_connection_id) {
      await sendOfficialReaction(service, {
        agencyId: context.agency.id, connectionId: conversation.whatsapp_connection_id, to: conversation.remote_id,
        targetExternalId: original.external_id, emoji: body.data.emoji,
      });
    } else {
      return Response.json({ error: "Número oficial indisponível." }, { status: 409, headers });
    }
    // The outgoing webhook may be delayed or absent. Persist our own update
    // immediately and idempotently; never create a chat message or unread badge.
    const recorded = await recordInboxReaction(service, { agencyId: context.agency.id,
      connectionId: conversation.whatsapp_connection_id, reaction: {
        remoteId: conversation.remote_id, targetExternalId: original.external_id,
        reactorId: "me", emoji: body.data.emoji, at: new Date().toISOString(),
      },
    });
    return Response.json({ ok: true, recorded }, { headers });
  } catch (error) {
    const detail = error instanceof EvolutionError || error instanceof WhatsAppSetupError ? error.message
      : "Não foi possível enviar a reação. Tente novamente.";
    return Response.json({ error: detail }, { status: 502, headers });
  }
}
