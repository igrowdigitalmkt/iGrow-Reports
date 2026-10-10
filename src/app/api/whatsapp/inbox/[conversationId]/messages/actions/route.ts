import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canPinMessages, canDeleteOwnMessage, canRevokeForEveryone } from "@/modules/whatsapp/message-actions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { revokeQrSentMessage } from "@/modules/whatsapp-qr/server";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({
  messageIds: z.array(z.uuid()).min(1).max(30),
  action: z.enum(["pin", "unpin", "hide", "revoke"]),
});

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const chatId = z.uuid().safeParse((await params).conversationId);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!chatId.success || !input.success)
    return Response.json({ error: "Ação ou seleção inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  if (context.role === "viewer") return Response.json({ error: "Seu perfil não pode apagar mensagens." }, { status: 403, headers });
  const modules = ["owner", "admin"].includes(context.role) ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  if (!canOpenSection(context.role, modules, "whatsapp")) return Response.json({ error: "Sem acesso ao WhatsApp." }, { status: 403, headers });
  const agencyId = context.agency.id;
  const userId = context.user.id;
  const ids = [...new Set(input.data.messageIds)];
  const { data: chat, error: chatError } = await context.supabase.from("whatsapp_conversations")
    .select("id,channel,remote_id,last_message_at,last_message_direction,last_message_preview").eq("agency_id", agencyId).eq("id", chatId.data).maybeSingle();
  if (chatError || !chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  const { data: messages, error: messageError } = await context.supabase.from("whatsapp_messages")
    .select("id,direction,external_id,sent_at,revoked_at,body").eq("agency_id", agencyId).eq("conversation_id", chat.id).in("id", ids);
  if (messageError || !messages || messages.length !== ids.length)
    return Response.json({ error: "Uma das mensagens não pertence a esta conversa." }, { status: 404, headers });

  // Absolutely no conversation deletion and no incoming-message deletion.
  if ((input.data.action === "hide" || input.data.action === "revoke")
    && messages.some(message => !canDeleteOwnMessage({ direction: message.direction, revoked: !!message.revoked_at }))) {
    return Response.json({ error: "Somente mensagens enviadas e não apagadas podem ser excluídas." }, { status: 403, headers });
  }
  if (input.data.action === "revoke") {
    // Cloud API has no dependable delete-for-everyone endpoint. Never pretend
    // that hiding an official message locally removed it on recipients' phones.
    if (chat.channel !== "qr")
      return Response.json({ error: "Apagar para todos só está disponível para números conectados por QR Code." }, { status: 409, headers });
    if (messages.length > 10)
      return Response.json({ error: "Apague até dez mensagens por vez." }, { status: 400, headers });
    if (messages.some(message => !canRevokeForEveryone({
      direction: message.direction, revoked: !!message.revoked_at, externalId: message.external_id,
      sentAt: message.sent_at, channel: chat.channel,
    }))) return Response.json({ error: "Uma ou mais mensagens ultrapassaram o prazo aproximado de dois dias, ou não têm ID válido no WhatsApp." }, { status: 409, headers });
    const service = createSupabaseServiceClient();
    if (!service) return Response.json({ error: "Não foi possível registrar a exclusão com segurança." }, { status: 503, headers });
    let completed = 0;
    for (const message of messages) {
      try {
        await revokeQrSentMessage(agencyId, chat.remote_id, message.external_id);
        // A tombstone is shared by all iGrow users; the original message ID
        // stays for receipts/history and cannot be re-shown by delayed imports.
        const time = new Date().toISOString();
        const { error } = await service.from("whatsapp_messages").update({
          revoked_at: time, body: null, media_id: null, media_ref: null,
          media_name: null, media_mime: null,
        }).eq("agency_id", agencyId).eq("conversation_id", chat.id).eq("id", message.id).eq("direction", "out");
        if (error) throw new Error("O WhatsApp recebeu a solicitação, mas o histórico do iGrow ainda não foi atualizado.");
        // Refresh preview only if it still belongs to exactly this message.
        if (chat.last_message_direction === "out" && chat.last_message_at &&
          Date.parse(chat.last_message_at) === Date.parse(message.sent_at)) {
          await service.from("whatsapp_conversations").update({ last_message_preview: "Mensagem apagada", updated_at: time })
            .eq("agency_id", agencyId).eq("id", chat.id).eq("last_message_direction", "out")
            .eq("last_message_at", message.sent_at);
        }
        completed++;
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : "O WhatsApp não confirmou a solicitação de exclusão.",
          completed, requested: messages.length,
        }, { status: 502, headers });
      }
    }
    return Response.json({ ok: true, count: completed, scope: "whatsapp_for_everyone",
      notice: "Solicitação de exclusão enviada ao WhatsApp. A entrega a todos os aparelhos depende do WhatsApp." }, { headers });
  }
  // WhatsApp-like pin limit, scoped to this user's private iGrow view.
  if (input.data.action === "pin") {
    const { data: pins, error: pinsError } = await context.supabase.from("whatsapp_message_user_actions")
      .select("message_id").eq("agency_id", agencyId).eq("user_id", userId)
      .not("pinned_at", "is", null).is("hidden_at", null).limit(500);
    if (pinsError) return Response.json({ error: "Não foi possível consultar as mensagens fixadas." }, { status: 503, headers });
    const pinnedIds = (pins ?? []).map(item => item.message_id);
    const { data: sameChatPins } = pinnedIds.length
      ? await context.supabase.from("whatsapp_messages").select("id").eq("agency_id", agencyId)
        .eq("conversation_id", chat.id).in("id", pinnedIds)
      : { data: [] };
    const currentPins = new Set((sameChatPins ?? []).map(item => item.id));
    if (!canPinMessages([...currentPins], ids))
      return Response.json({ error: "Você pode fixar até três mensagens por conversa no iGrow." }, { status: 409, headers });
  }

  // Keep per-user actions, rather than mutating/deleting the shared message
  // or attempting unsafe WhatsApp device-wide deletion.
  const now = new Date().toISOString();
  for (const messageId of ids) {
    const { data: existing, error: existingError } = await context.supabase.from("whatsapp_message_user_actions")
      .select("message_id,pinned_at,hidden_at").eq("agency_id", agencyId).eq("user_id", userId)
      .eq("message_id", messageId).maybeSingle();
    if (existingError) return Response.json({ error: "Não foi possível consultar a ação." }, { status: 503, headers });
    const { error } = await context.supabase.from("whatsapp_message_user_actions").upsert({
      agency_id: agencyId, user_id: userId, message_id: messageId,
      pinned_at: input.data.action === "hide" || input.data.action === "unpin" ? null : now,
      hidden_at: input.data.action === "hide" ? now : existing?.hidden_at ?? null,
    }, { onConflict: "agency_id,user_id,message_id" });
    if (error) return Response.json({ error: "Algumas ações não puderam ser salvas. Atualize a conversa." }, { status: 503, headers });
  }
  return Response.json({ ok: true, count: ids.length, scope: "igrow_only" }, { headers });
}
