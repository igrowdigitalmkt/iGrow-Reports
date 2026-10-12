import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
vi.mock("server-only", () => ({}));
import { recordInboxMessage } from "@/modules/whatsapp/inbox-store";
it("hydrates only missing text on the exact unretracted QR message and its current preview", async () => {
  const calls:Array<{url:URL;body:unknown}>=[];
  const client=createClient<Database>("https://db.example.test","key",{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    const url=new URL(String(input));calls.push({url,body:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify(url.pathname.includes("/rpc/")?[{conversation_id:"chat",inserted:false,needs_title:false}]:url.pathname.endsWith("whatsapp_messages")?[{id:"message"}]:[]),{headers:{"Content-Type":"application/json"}});
  }}});
  await recordInboxMessage(client,{agencyId:"agency",connectionId:null,message:{remoteId:"123456789@lid",isGroup:false,title:null,author:null,externalId:"native-id",direction:"in",kind:"template",body:"Conteúdo recuperado",mediaName:null,mediaMime:null,sentAt:"2026-10-12T00:00:00Z"}});
  const update=calls[1];
  expect(update.body).toEqual({body:"Conteúdo recuperado"});
  expect(Object.fromEntries(update.url.searchParams)).toMatchObject({agency_id:"eq.agency",conversation_id:"eq.chat",external_id:"eq.native-id",direction:"eq.in",body:"is.null",revoked_at:"is.null"});
  expect(calls[2].url.searchParams.get("last_message_at")).toBe("eq.2026-10-12T00:00:00Z");
});
it("does not change the conversation preview when the original body already exists", async () => {
  const paths:string[]=[];
  const client=createClient<Database>("https://db.example.test","key",{auth:{persistSession:false},global:{fetch:async input=>{
    const url=new URL(String(input));paths.push(url.pathname);
    return new Response(JSON.stringify(url.pathname.includes("/rpc/")?[{conversation_id:"chat",inserted:false,needs_title:false}]:[]),{headers:{"Content-Type":"application/json"}});
  }}});
  await recordInboxMessage(client,{agencyId:"agency",connectionId:null,message:{remoteId:"123456789@lid",isGroup:false,title:null,author:null,externalId:"native-id",direction:"in",kind:"template",body:"Novo conteúdo",mediaName:null,mediaMime:null,sentAt:"2026-10-12T00:00:00Z"}});
  expect(paths.some(path=>path.endsWith("whatsapp_conversations"))).toBe(false);
});
