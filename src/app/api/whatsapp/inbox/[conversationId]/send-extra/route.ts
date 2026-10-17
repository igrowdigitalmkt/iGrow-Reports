import { z } from "zod";
import { paidOperationBlock } from "@/modules/billing/guard";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { extendedSendSchema } from "@/modules/whatsapp/extended-send";
import { sendQrExtended } from "@/modules/whatsapp-qr/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordInboxMessage } from "@/modules/whatsapp/inbox-store";
import sharp from "sharp";
export const runtime="nodejs";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request,{params}:{params:Promise<{conversationId:string}>}) {
  const id=z.uuid().safeParse((await params).conversationId);
  const payload=extendedSendSchema.safeParse(await request.json().catch(()=>null));
  if(!id.success || !payload.success)return Response.json({error:"Dados inválidos."},{status:400,headers});
  const context=await requireAgencyContext();
  const modules=["owner","admin"].includes(context.role)?null:await loadOwnModules(context.supabase,context.agency.id,context.user.id);
  if(context.role==="viewer" || !canOpenSection(context.role,modules,"whatsapp"))return Response.json({error:"Sem permissão para enviar."},{status:403,headers});
  const billingBlock=await paidOperationBlock(context.agency.id);
  if(billingBlock)return Response.json({error:billingBlock.error,code:billingBlock.code},{status:billingBlock.status,headers});
  const {data:chat,error}=await context.supabase.from("whatsapp_conversations").select("id,channel,remote_id,is_group,whatsapp_connection_id").eq("agency_id",context.agency.id).eq("id",id.data).maybeSingle();
  if(error || !chat)return Response.json({error:"Conversa não encontrada."},{status:404,headers});
  if(chat.channel!=="qr")return Response.json({error:"Este envio exige WhatsApp conectado por QR Code."},{status:409,headers});
  const service=createSupabaseServiceClient();
  if(!service)return Response.json({error:"Envio indisponível."},{status:503,headers});
  if(payload.data.type==="sticker") {
    try {
      const bytes=Buffer.from(payload.data.base64,"base64");
      if(bytes.length>400000)throw Error("too large");
      const image=sharp(bytes,{limitInputPixels:16777216,animated:false});
      const metadata=await image.metadata();
      if(!["png","jpeg","webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1)>1)throw Error("invalid image");
      const webp=await image.resize(512,512,{fit:"contain",background:{r:0,g:0,b:0,alpha:0}}).webp({quality:80}).toBuffer();
      if(webp.length>100000)throw Error("too large");
      payload.data={type:"sticker",base64:webp.toString("base64")};
    }catch{return Response.json({error:"Use uma imagem PNG, JPEG ou WebP estática de até 400 KB."},{status:400,headers});}
  }
  let externalId:string;
  try {externalId=await sendQrExtended(context.agency.id,chat.remote_id,payload.data);}
  catch{return Response.json({error:"O WhatsApp não confirmou o envio. Confira a conversa antes de tentar novamente."},{status:502,headers});}
  try {
    const content=payload.data;
    await recordInboxMessage(service,{agencyId:context.agency.id,connectionId:chat.whatsapp_connection_id,message:{remoteId:chat.remote_id,isGroup:chat.is_group,title:null,author:null,externalId,direction:"out",kind:content.type==="sticker"?"sticker":"text",body:content.type==="sticker"?null:content.type==="poll" ? `Enquete: ${content.name}\n${content.options.map(option=>"• "+option).join("\n")}` : `Contato: ${content.name}\n+${content.phone}`,mediaName:null,mediaMime:content.type==="sticker"?"image/webp":null,sentAt:new Date().toISOString(),mediaId:null}});
  }catch{return Response.json({error:"Enviado no WhatsApp; a atualização no Groow Ads está pendente. Atualize a conversa sem reenviar."},{status:503,headers});}
  return Response.json({ok:true},{headers});
}
