import { requireAgencyContext } from "@/modules/agencies/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { EvolutionClient, evolutionConfig } from "@/modules/whatsapp-qr/evolution";
import { instanceNameFor } from "@/modules/whatsapp-qr/format";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { WHATSAPP_QR_RECENT_DAYS } from "@/modules/whatsapp/recent-policy";
export const runtime="nodejs";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
export async function GET() {
  const context=await requireAgencyContext();
  const modules=["owner","admin"].includes(context.role)?null:await loadOwnModules(context.supabase,context.agency.id,context.user.id);
  if(!canOpenSection(context.role,modules,"whatsapp"))return Response.json({error:"Sem permissão."},{status:403,headers});
  const config=evolutionConfig(),service=createSupabaseServiceClient();
  if(!config||!service)return Response.json({error:"WhatsApp indisponível."},{status:503,headers});
  const {data:guard,error:guardError}=await service.from("whatsapp_qr_reset_guards").select("blocked,fresh_after").eq("agency_id",context.agency.id).maybeSingle();
  if(guardError||guard?.blocked)return Response.json({error:"Reconecte o WhatsApp."},{status:409,headers});
  const {data:chats,error}=await context.supabase.from("whatsapp_conversations").select("id,remote_id,favorite,archived,updated_at")
    .eq("agency_id",context.agency.id).eq("channel","qr").gte("last_message_at",new Date(Date.now()-WHATSAPP_QR_RECENT_DAYS*86_400_000).toISOString()).limit(500);
  if(error)return Response.json({error:"Conversas indisponíveis."},{status:503,headers});
  const scoped=(chats??[]).map(chat=>({...chat,peer:chat.remote_id.includes("@")?chat.remote_id:`${chat.remote_id}@s.whatsapp.net`}));
  try {
    const native=scoped.length?await new EvolutionClient(config).conversationStates(instanceNameFor(context.agency.id),scoped.map(chat=>chat.peer)):[];
    const {data:current,error:currentError}=await service.from("whatsapp_qr_reset_guards").select("blocked,fresh_after").eq("agency_id",context.agency.id).maybeSingle();
    if(currentError||current?.blocked||current?.fresh_after!==guard?.fresh_after)return Response.json({error:"Conexão alterada."},{status:409,headers});
    const states=[];
    for(const state of native){
      const chat=scoped.find(chat=>chat.peer===state.peer);if(!chat)continue;
      states.push({id:chat.id,pinned:state.pinned,archived:state.archived,markedUnread:state.markedUnread,favorite:state.favorite,favoritesSupported:state.favoritesSupported,favoritesReadable:state.favoritesReadable});
      const patch:{favorite?:boolean;archived?:boolean}={};
      if(state.favoritesReadable&&chat.favorite!==state.favorite)patch.favorite=state.favorite;
      if(chat.archived!==state.archived)patch.archived=state.archived;
      if(Object.keys(patch).length)await service.from("whatsapp_conversations").update(patch).eq("agency_id",context.agency.id).eq("id",chat.id).eq("channel","qr").eq("updated_at",chat.updated_at);
    }
    return Response.json({states},{headers});
  }catch{return Response.json({error:"Estado nativo indisponível."},{status:502,headers});}
}
