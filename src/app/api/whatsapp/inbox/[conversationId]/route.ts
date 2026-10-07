import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadThread } from "@/modules/whatsapp/inbox-read";
import { archiveQrChat, markQrRead } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const id = z.uuid().safeParse((await params).conversationId);
  if (!id.success) return Response.json({ error: "Conversa inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  return Response.json(await loadThread(context.supabase, context.agency.id, id.data), { headers });
}

// Marks the conversation as read or toggles the favorite (database functions check access).
export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const id = z.uuid().safeParse((await params).conversationId);
  const body = z.discriminatedUnion("action", [
    z.object({ action: z.literal("read") }),
    z.object({ action: z.literal("favorite"), value: z.boolean() }),
    z.object({ action: z.literal("archive"), value: z.boolean() }),
  ]).safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const { data: conversation } = await context.supabase.from("whatsapp_conversations").select("channel,remote_id,unread_count").eq("agency_id", context.agency.id).eq("id", id.data).maybeSingle();
  if (!conversation) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  const action = body.data;
  // Read and archive also happen on the phone for the QR Code session, like WhatsApp Web.
  if (conversation.channel === "qr" && action.action === "read" && conversation.unread_count > 0) {
    const { data: unread } = await context.supabase.from("whatsapp_messages").select("external_id").eq("agency_id", context.agency.id).eq("conversation_id", id.data)
      .eq("direction", "in").order("sent_at", { ascending: false }).limit(Math.min(conversation.unread_count, 20));
    await markQrRead(context.agency.id, conversation.remote_id, (unread ?? []).map(row => row.external_id));
  }
  if (conversation.channel === "qr" && action.action === "archive") {
    const { data: last } = await context.supabase.from("whatsapp_messages").select("external_id,direction,sent_at").eq("agency_id", context.agency.id).eq("conversation_id", id.data)
      .order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (last) await archiveQrChat(context.agency.id, conversation.remote_id, { id: last.external_id, fromMe: last.direction === "out", sentAt: last.sent_at }, action.value);
  }
  const { error } = action.action === "read"
    ? await context.supabase.rpc("mark_whatsapp_conversation_read", { p_conversation_id: id.data })
    : action.action === "favorite"
      ? await context.supabase.rpc("set_whatsapp_conversation_favorite", { p_conversation_id: id.data, p_favorite: action.value })
      : await context.supabase.rpc("set_whatsapp_conversation_archived", { p_conversation_id: id.data, p_archived: action.value });
  if (error) return Response.json({ error: error.code === "PGRST202" ? "Arquivar precisa da atualização do banco de dados." : "Não foi possível atualizar a conversa." }, { status: 500, headers });
  return Response.json({ ok: true }, { headers });
}
