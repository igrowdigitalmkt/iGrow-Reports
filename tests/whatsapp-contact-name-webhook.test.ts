import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
const mocks=vi.hoisted(()=>({service:vi.fn(),bind:vi.fn(),canonical:vi.fn(),cleanup:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/service",()=>({createSupabaseServiceClient:mocks.service}));
vi.mock("@/modules/whatsapp-qr/server",()=>({qrGroupSubject:vi.fn(),replyFromInstance:vi.fn(),validWebhookToken:(_instance:string,token:string,epoch?:string)=>token==="scoped"||(token==="legacy"&&!epoch)}));
vi.mock("@/modules/whatsapp-qr/peer-identity",()=>({bindQrPeerLinks:mocks.bind,qrPeerLinks:vi.fn(),canonicalQrPeers:mocks.canonical}));
vi.mock("@/modules/whatsapp-qr/session-lifecycle",()=>({clearQrInboxForLostSession:mocks.cleanup}));
import { POST } from "@/app/api/webhooks/evolution/route";
const agency="11111111-1111-4111-8111-111111111111";
let blocked:boolean;
let changes:Array<{url:URL;body:unknown;method:string}>;
const post=(token="scoped")=>POST(new Request("https://app.example.test/api/webhooks/evolution",{method:"POST",headers:{"x-igrow-token":token},body:JSON.stringify({instance:`igrow-${agency}`,event:"contacts.upsert",data:[{remoteJid:"5586999999999@s.whatsapp.net",lidJid:"123456789@lid",igrowSavedName:"Nome salvo ❤️"}]})}));
beforeEach(()=>{
  vi.clearAllMocks();blocked=false;changes=[];mocks.canonical.mockResolvedValue(new Map());
  mocks.service.mockReturnValue(createClient<Database>("https://db.example.test","test-key",{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    const url=new URL(String(input));expect(url.searchParams.get("agency_id")).toBe(`eq.${agency}`);
    if(url.pathname.endsWith("whatsapp_qr_reset_guards"))return new Response(JSON.stringify({blocked,fresh_after:"2026-10-10T00:00:00Z"}),{headers:{"Content-Type":"application/json"}});
    changes.push({url,body:JSON.parse(String(init?.body)),method:init?.method??"GET"});return new Response("[]",{headers:{"Content-Type":"application/json"}});
  }}}));
});
it("changes only name metadata in existing QR contacts; never merges or deletes inbox data",async()=>{
  expect((await post()).status).toBe(200);expect(changes).toHaveLength(1);
  expect(changes[0].method).toBe("PATCH");expect(changes[0].url.pathname).toBe("/rest/v1/whatsapp_conversations");
  expect(changes[0].url.searchParams.get("channel")).toBe("eq.qr");expect(changes[0].url.searchParams.get("is_group")).toBe("eq.false");
  expect(changes[0].url.searchParams.get("remote_id")).toBe("in.(5586999999999,123456789@lid)");
  expect(Object.keys(changes[0].body as object).sort()).toEqual(["title","updated_at"]);
  expect(mocks.bind).not.toHaveBeenCalled();expect(mocks.cleanup).not.toHaveBeenCalled();
});
it("ignores contact events from an old signature or during session reset",async()=>{
  expect(await(await post("legacy")).json()).toMatchObject({ignored:"old_session_contacts"});
  blocked=true;expect(await(await post()).json()).toMatchObject({ignored:"reset_in_progress"});
  expect(changes).toEqual([]);expect(mocks.canonical).not.toHaveBeenCalled();expect(mocks.bind).not.toHaveBeenCalled();
});
it("rejects forged signatures before contact metadata reads or mutations",async()=>{
  expect((await post("forged")).status).toBe(401);expect(changes).toEqual([]);expect(mocks.canonical).not.toHaveBeenCalled();
});
