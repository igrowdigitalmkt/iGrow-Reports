import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { EvolutionClient, evolutionConfig } from "@/modules/whatsapp-qr/evolution";
import { instanceNameFor } from "@/modules/whatsapp-qr/format";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { conversationMessageRange } from "@/modules/whatsapp/conversation-message-range";
export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ action: z.enum(["archive", "pin", "unread", "favorite"]), value: z.boolean(), expected: z.boolean() }).strict();
async function execute(id: string, change?: z.infer<typeof schema>) {
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Conversa inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  const modules = ["owner", "admin"].includes(context.role) ? null : await loadOwnModules(context.supabase, context.agency.id, context.user.id);
  if (!canOpenSection(context.role, modules, "whatsapp") || (change && context.role === "viewer")) return Response.json({ error: "Sem permissão." }, { status: 403, headers });
  const { data: chat } = await context.supabase.from("whatsapp_conversations").select("id,channel,remote_id,is_group,unread_count,last_message_at").eq("agency_id", context.agency.id).eq("id", id).maybeSingle();
  if (!chat) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  if (chat.channel !== "qr") return Response.json({ error: "A sincronização exige conexão por QR Code." }, { status: 409, headers });
  const config = evolutionConfig(), service = createSupabaseServiceClient();
  if (!config || !service) return Response.json({ error: "WhatsApp indisponível." }, { status: 503, headers });
  const { data: guard, error: guardError } = await service.from("whatsapp_qr_reset_guards").select("blocked,fresh_after").eq("agency_id", context.agency.id).maybeSingle();
  if (guardError || guard?.blocked) return Response.json({ error: "Reconecte o WhatsApp." }, { status: 409, headers });
  const epoch = guard?.fresh_after;
  try {
    let lastMessages;
    if (change && ["archive", "unread"].includes(change.action)) {
      const { data: messages, error } = await context.supabase.from("whatsapp_messages").select("external_id,direction,sent_at,participant_jid")
        .eq("agency_id", context.agency.id).eq("conversation_id", id).neq("kind", "reaction").order("sent_at", { ascending: false }).limit(100);
      if (error || !messages?.length) return Response.json({ error: "Não foi possível recuperar a referência das mensagens." }, { status: 409, headers });
      const range=conversationMessageRange(messages,chat.is_group);
      if (!range) return Response.json({ error: "Não foi possível confirmar as últimas mensagens desta conversa. Atualize e tente novamente." }, { status: 409, headers });
      lastMessages = range;
    }
    const result = await new EvolutionClient(config).conversationControl(instanceNameFor(context.agency.id), chat.remote_id.includes("@") ? chat.remote_id : `${chat.remote_id}@s.whatsapp.net`, change, lastMessages);
    const { data: current, error: currentError } = await service.from("whatsapp_qr_reset_guards").select("blocked,fresh_after").eq("agency_id", context.agency.id).maybeSingle();
    if (currentError || current?.blocked || current?.fresh_after !== epoch) return Response.json({ error: "A conexão mudou. Atualize a página." }, { status: 409, headers });
    // Reconcile native metadata only. Never changes or hides message content.
    if (result.favoritesReadable) await context.supabase.rpc("set_whatsapp_conversation_favorite", { p_conversation_id: id, p_favorite: result.favorite });
    await context.supabase.rpc("set_whatsapp_conversation_archived", { p_conversation_id: id, p_archived: result.archived });
    if (change?.action === "unread" && chat.last_message_at) await service.from("whatsapp_conversations")
      .update({unread_count:result.markedUnread?Math.max(1,chat.unread_count):0}).eq("agency_id",context.agency.id).eq("id",id)
      .eq("last_message_at",chat.last_message_at).eq("unread_count",chat.unread_count);
    return Response.json(result, { headers });
  } catch {
    return Response.json({ error: "O WhatsApp não confirmou a alteração. Atualize o estado e tente novamente." }, { status: 502, headers });
  }
}
export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) { return execute((await params).conversationId); }
export async function PATCH(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Pedido inválido." }, { status: 400, headers });
  return execute((await params).conversationId, body.data);
}
