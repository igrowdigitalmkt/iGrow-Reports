import {z} from "zod";
import {requireAgencyContext} from "@/modules/agencies/context";
import {loadOwnModules} from "@/modules/team/admin";
import {canOpenSection} from "@/modules/team/permissions";
import {qrMute} from "@/modules/whatsapp-qr/server";
export const runtime="nodejs";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
const changeSchema=z.object({duration:z.enum(["8h","7d","off"]),expectedMuted:z.boolean(),expectedUntil:z.number().int().safe().nullable()}).strict();
async function execute(id:string,change?:z.infer<typeof changeSchema>) {
  if(!z.uuid().safeParse(id).success)return Response.json({error:"Conversa inválida."},{status:400,headers});
  const context=await requireAgencyContext();
  const modules=["owner","admin"].includes(context.role)?null:await loadOwnModules(context.supabase,context.agency.id,context.user.id);
  if(!canOpenSection(context.role,modules,"whatsapp") || (change && context.role==="viewer"))return Response.json({error:"Sem permissão para esta ação."},{status:403,headers});
  const {data:chat,error}=await context.supabase.from("whatsapp_conversations").select("id,channel,remote_id").eq("agency_id",context.agency.id).eq("id",id).maybeSingle();
  if(error || !chat)return Response.json({error:"Conversa não encontrada."},{status:404,headers});
  if(chat.channel!=="qr")return Response.json({error:"O silenciamento nativo exige conexão por QR Code."},{status:409,headers});
  try{return Response.json(await qrMute(context.agency.id,chat.remote_id,change),{headers});}
  catch{return Response.json({error:"Não foi possível confirmar o estado no WhatsApp. Atualize os dados antes de tentar novamente."},{status:502,headers});}
}
export async function GET(_request:Request,{params}:{params:Promise<{conversationId:string}>}) {return execute((await params).conversationId);}
export async function PATCH(request:Request,{params}:{params:Promise<{conversationId:string}>}) {
  const body=changeSchema.safeParse(await request.json().catch(()=>null));
  if(!body.success)return Response.json({error:"Pedido inválido."},{status:400,headers});
  return execute((await params).conversationId,body.data);
}
