import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { canPinMessages } from "@/modules/whatsapp/message-actions";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({
  messageIds: z.array(z.uuid()).min(1).max(30),
  action: z.enum(["pin", "unpin", "hide"]),
});

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const chatId = z.uuid().safeParse((await params).conversationId);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!chatId.success || !input.success)
    return Response.json({ error: "Ação ou seleção inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const agencyId = context.agency.id;
  const userId = context.user.id;
  const ids = [...new Set(input.data.messageIds)];
  const { data: chat, error: chatError } = await context.supabase.from("whatsapp_conversations")
    .select("id").eq("agency_id", agencyId).eq("id", chatId.data).maybeSingle();
  if (chatError || !chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  const { data: messages, error: messageError } = await context.supabase.from("whatsapp_messages")
    .select("id").eq("agency_id", agencyId).eq("conversation_id", chat.id).in("id", ids);
  if (messageError || !messages || messages.length !== ids.length)
    return Response.json({ error: "Uma das mensagens não pertence a esta conversa." }, { status: 404, headers });

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
