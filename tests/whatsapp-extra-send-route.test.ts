import {beforeEach,expect,it,vi} from "vitest";
import {createClient} from "@supabase/supabase-js";
import sharp from "sharp";
const mocks=vi.hoisted(()=>({context:vi.fn(),modules:vi.fn(),send:vi.fn(),service:vi.fn(),record:vi.fn()}));
vi.mock("@/modules/billing/guard", () => ({ paidOperationBlock: async () => null, billingBlockOf: () => null, ensurePaidOperation: async () => undefined, BillingRestrictedError: class extends Error {} }));
vi.mock("server-only",()=>({}));
vi.mock("@/modules/agencies/context",()=>({requireAgencyContext:mocks.context}));
vi.mock("@/modules/team/admin",()=>({loadOwnModules:mocks.modules}));
vi.mock("@/modules/whatsapp-qr/server",()=>({sendQrExtended:mocks.send}));
vi.mock("@/lib/supabase/service",()=>({createSupabaseServiceClient:mocks.service}));
vi.mock("@/modules/whatsapp/inbox-store",()=>({recordInboxMessage:mocks.record}));
import {POST} from "@/app/api/whatsapp/inbox/[conversationId]/send-extra/route";
const id="00000000-0000-4000-8000-000000000001",agency="00000000-0000-4000-8000-000000000002";
let found=true,channel="qr";const queries:URL[]=[];
const poll={type:"poll",name:"Pergunta?",options:["Sim","Não"],multiple:false};
const send=(body:unknown)=>POST(new Request("https://app.test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({conversationId:id})});
beforeEach(()=>{
  vi.clearAllMocks();found=true;channel="qr";queries.length=0;
  const client=createClient("https://db.test","key",{global:{fetch:async request=>{const url=new URL(String(request));queries.push(url);return new Response(JSON.stringify(found?{id,remote_id:"5586999999999",channel,is_group:false,whatsapp_connection_id:null}:null),{headers:{"Content-Type":"application/json"}});}}});
  mocks.context.mockResolvedValue({supabase:client,agency:{id:agency},user:{id:agency},role:"editor"});mocks.modules.mockResolvedValue(["whatsapp"]);mocks.service.mockReturnValue({});mocks.send.mockResolvedValue("native-id");mocks.record.mockResolvedValue(undefined);
});
it("only sends after agency, module, channel and role checks, then records the confirmed outgoing id",async()=>{
  expect((await send(poll)).status).toBe(200);expect(mocks.send).toHaveBeenCalledWith(agency,"5586999999999",poll);
  expect(queries[0].searchParams.get("agency_id")).toBe("eq."+agency);expect(queries[0].searchParams.get("id")).toBe("eq."+id);
  expect(mocks.record.mock.calls[0][1].message).toMatchObject({direction:"out",externalId:"native-id"});
  mocks.send.mockClear();(await mocks.context()).role="viewer";expect((await send(poll)).status).toBe(403);expect(mocks.send).not.toHaveBeenCalled();
  (await mocks.context()).role="editor";mocks.modules.mockResolvedValue([]);expect((await send(poll)).status).toBe(403);
  mocks.modules.mockResolvedValue(["whatsapp"]);found=false;expect((await send(poll)).status).toBe(404);
  found=true;channel="official";expect((await send(poll)).status).toBe(409);expect(mocks.send).not.toHaveBeenCalled();
});
it("rejects vCard injection, duplicate poll choices, foreign routing and destructive payloads before sending",async()=>{
  for(const body of [{type:"contact",name:"Nome\nTEL:+123",phone:"5586999999999"},{...poll,options:["Sim"," sim "]},{...poll,options:["Uma"]},{...poll,agencyId:agency},{...poll,replyTo:id},{type:"delete",messageId:id}])expect((await send(body)).status).toBe(400);
  expect(mocks.send).not.toHaveBeenCalled();expect(mocks.record).not.toHaveBeenCalled();
});
it("verifies image bytes, creates a static 512px WebP and refuses malformed images without native mutations",async()=>{
  const bytes=await sharp({create:{width:20,height:30,channels:4,background:"red"}}).png().toBuffer();
  expect((await send({type:"sticker",base64:bytes.toString("base64")})).status).toBe(200);
  const sent=mocks.send.mock.calls[0][2];const image=await sharp(Buffer.from(sent.base64,"base64")).metadata();expect(image).toMatchObject({format:"webp",width:512,height:512});
  mocks.send.mockClear();expect((await send({type:"sticker",base64:Buffer.from("invalid image").toString("base64")})).status).toBe(400);expect(mocks.send).not.toHaveBeenCalled();
});
it("does not project unconfirmed sends and explains a failure after native acceptance without encouraging resend",async()=>{
  mocks.send.mockRejectedValue(Error("timeout"));expect((await send(poll)).status).toBe(502);expect(mocks.record).not.toHaveBeenCalled();
  mocks.send.mockResolvedValue("native-id");mocks.record.mockRejectedValue(Error("database"));const response=await send(poll);expect(response.status).toBe(503);expect((await response.json()).error).toContain("sem reenviar");
});
