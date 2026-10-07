import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadThread } from "@/modules/whatsapp/inbox-read";

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
  ]).safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const { error } = body.data.action === "read"
    ? await context.supabase.rpc("mark_whatsapp_conversation_read", { p_conversation_id: id.data })
    : await context.supabase.rpc("set_whatsapp_conversation_favorite", { p_conversation_id: id.data, p_favorite: body.data.value });
  if (error) return Response.json({ error: "Não foi possível atualizar a conversa." }, { status: 500, headers });
  return Response.json({ ok: true }, { headers });
}
