import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadThread } from "@/modules/whatsapp/inbox-read";
import { markQrRead } from "@/modules/whatsapp-qr/server";
import { EvolutionClient, evolutionConfig } from "@/modules/whatsapp-qr/evolution";
import { instanceNameFor } from "@/modules/whatsapp-qr/format";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { conversationMessageRange } from "@/modules/whatsapp/conversation-message-range";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const id = z.uuid().safeParse((await params).conversationId);
  if (!id.success) return Response.json({ error: "Conversa inválida." }, { status: 400, headers });
  const context = await requireAgencyContext();
  return Response.json(await loadThread(context.supabase, context.agency.id, id.data, context.user.id), { headers });
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
  const modules=["owner","admin"].includes(context.role)?null:await loadOwnModules(context.supabase,context.agency.id,context.user.id);
  if(!canOpenSection(context.role,modules,"whatsapp")||(body.data.action!=="read"&&context.role==="viewer"))return Response.json({error:"Sem permissão para esta ação."},{status:403,headers});
  const { data: conversation } = await context.supabase.from("whatsapp_conversations").select("channel,remote_id,unread_count,is_group").eq("agency_id", context.agency.id).eq("id", id.data).maybeSingle();
  if (!conversation) return Response.json({ error: "Conversa não encontrada." }, { status: 404, headers });
  const action = body.data;
  if (conversation.channel === "qr" && action.action === "favorite") {
    return Response.json({error:"Altere os favoritos no WhatsApp oficial. A alteração aparece na iGrow."},{status:409,headers});
  }
  // Read and archive also happen on the phone for the QR Code session, like WhatsApp Web.
  if (conversation.channel === "qr" && action.action === "read" && conversation.unread_count > 0) {
    const { data: unread, error: unreadError } = await context.supabase.from("whatsapp_messages").select("external_id").eq("agency_id", context.agency.id).eq("conversation_id", id.data)
      .eq("direction", "in").order("sent_at", { ascending: false }).limit(Math.min(conversation.unread_count, 100));
    if (unreadError) return Response.json({ error: "Não foi possível consultar as mensagens pendentes." }, { status: 503, headers });
    try {
      await markQrRead(context.agency.id, conversation.remote_id, (unread ?? []).map(row => row.external_id));
    } catch {
      return Response.json({ error: "Não foi possível sincronizar a leitura com o WhatsApp." }, { status: 502, headers });
    }
  }
  if (conversation.channel === "qr" && action.action === "archive") {
    const config=evolutionConfig(),service=createSupabaseServiceClient();
    if(!config||!service)return Response.json({error:"WhatsApp indisponível."},{status:503,headers});
    const {data:guard,error:guardError}=await service.from("whatsapp_qr_reset_guards").select("blocked,fresh_after").eq("agency_id",context.agency.id).maybeSingle();
    if(guardError||guard?.blocked)return Response.json({error:"Reconecte o WhatsApp."},{status:409,headers});
    const { data: messages } = await context.supabase.from("whatsapp_messages").select("external_id,direction,sent_at,participant_jid").eq("agency_id", context.agency.id).eq("conversation_id", id.data)
      .neq("kind","reaction").order("sent_at", { ascending: false }).limit(100);
    const range=conversationMessageRange(messages??[],conversation.is_group);
    if(!range)return Response.json({error:"Não foi possível confirmar as últimas mensagens da conversa."},{status:409,headers});
    try {
      const client=new EvolutionClient(config),instance=instanceNameFor(context.agency.id);
      const peer=conversation.remote_id.includes("@")?conversation.remote_id:`${conversation.remote_id}@s.whatsapp.net`;
      const state=await client.conversationControl(instance,peer);
      if(state.archived!==action.value)await client.conversationControl(instance,peer,{action:"archive",value:action.value,expected:state.archived},range);
      const {data:current,error:currentError}=await service.from("whatsapp_qr_reset_guards").select("blocked,fresh_after").eq("agency_id",context.agency.id).maybeSingle();
      if(currentError||current?.blocked||current?.fresh_after!==guard?.fresh_after)throw Error("Conexão alterada.");
    } catch {
      return Response.json({ error: "Não foi possível sincronizar o arquivamento com o WhatsApp." }, { status: 502, headers });
    }
  }
  const { error } = action.action === "read"
    ? await context.supabase.rpc("mark_whatsapp_conversation_read", { p_conversation_id: id.data })
    : action.action === "favorite"
      ? await context.supabase.rpc("set_whatsapp_conversation_favorite", { p_conversation_id: id.data, p_favorite: action.value })
      : await context.supabase.rpc("set_whatsapp_conversation_archived", { p_conversation_id: id.data, p_archived: action.value });
  if (error) return Response.json({ error: error.code === "PGRST202" ? "Arquivar precisa da atualização do banco de dados." : "Não foi possível atualizar a conversa." }, { status: 500, headers });
  return Response.json({ ok: true }, { headers });
}
