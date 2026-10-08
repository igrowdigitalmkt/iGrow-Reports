import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const context = await requireAgencyContext();
  const agency = context.agency.id;
  const user = context.user.id;
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (conversationId && !z.uuid().safeParse(conversationId).success)
    return Response.json({ error: "Conversa inválida." }, { status: 400, headers });
  const query = context.supabase.from("whatsapp_message_stars").select("message_id,created_at")
    .eq("agency_id", agency).eq("user_id", user).order("created_at", { ascending: false }).limit(200);
  const { data: stars, error } = await query;
  if (error) return Response.json({ error: "Favoritos indisponíveis." }, { status: 503, headers });
  if (!stars?.length) return Response.json({ items: [] }, { headers });
  const { data: messages, error: messagesError } = await context.supabase.from("whatsapp_messages")
    .select("id,conversation_id,body,kind,sent_at").eq("agency_id", agency).in("id", stars.map(star => star.message_id));
  if (messagesError) return Response.json({ error: "Mensagens indisponíveis." }, { status: 503, headers });
  // A message hidden by the current user must also disappear from their
  // favorite-message view. Other users' stars and message histories remain intact.
  const { data: hidden, error: hiddenError } = await context.supabase.from("whatsapp_message_user_actions")
    .select("message_id").eq("agency_id", agency).eq("user_id", user)
    .not("hidden_at", "is", null).in("message_id", stars.map(star => star.message_id));
  if (hiddenError) return Response.json({ error: "Favoritos indisponíveis." }, { status: 503, headers });
  const hiddenIds = new Set((hidden ?? []).map(item => item.message_id));
  const allowed = (messages ?? []).filter(message => !hiddenIds.has(message.id) &&
    (!conversationId || message.conversation_id === conversationId));
  if (!allowed.length) return Response.json({ items: [] }, { headers });
  const { data: chats, error: chatsError } = await context.supabase.from("whatsapp_conversations")
    .select("id,remote_id,title,is_group,channel_key").eq("agency_id", agency)
    .in("id", [...new Set(allowed.map(message => message.conversation_id))]);
  if (chatsError) return Response.json({ error: "Conversas indisponíveis." }, { status: 503, headers });
  const titles = new Map((chats ?? []).map(chat => [chat.id, chat]));
  const messageById = new Map(allowed.map(message => [message.id, message]));
  const items = stars.flatMap(star => {
    const message = messageById.get(star.message_id);
    const chat = message ? titles.get(message.conversation_id) : null;
    return message && chat ? [{
      id: message.id, conversationId: message.conversation_id, kind: message.kind,
      body: message.body, sentAt: message.sent_at, createdAt: star.created_at,
      title: chat.title, remoteId: chat.remote_id, isGroup: chat.is_group, channelKey: chat.channel_key,
    }] : [];
  });
  return Response.json({ items }, { headers });
}

export async function POST(request: Request) {
  const body = z.object({ messageId: z.uuid(), starred: z.boolean() })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Mensagem inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const agency = context.agency.id;
  const user = context.user.id;
  const { data: message } = await context.supabase.from("whatsapp_messages")
    .select("id").eq("agency_id", agency).eq("id", body.data.messageId).maybeSingle();
  if (!message) return Response.json({ error: "Mensagem não encontrada." }, { status: 404, headers });
  const query = context.supabase.from("whatsapp_message_stars");
  const { error } = body.data.starred
    ? await query.upsert({ agency_id: agency, user_id: user, message_id: message.id }, { onConflict: "agency_id,user_id,message_id" })
    : await query.delete().eq("agency_id", agency).eq("user_id", user).eq("message_id", message.id);
  if (error) return Response.json({ error: "Não foi possível salvar o favorito." }, { status: 503, headers });
  return Response.json({ ok: true }, { headers });
}
