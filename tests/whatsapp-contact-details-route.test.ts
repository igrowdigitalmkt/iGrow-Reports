import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context:vi.fn(), modules:vi.fn(), common:vi.fn(), group:vi.fn() }));
vi.mock("server-only",()=>({}));
vi.mock("@/modules/agencies/context",()=>({requireAgencyContext:mocks.context}));
vi.mock("@/modules/team/admin",()=>({loadOwnModules:mocks.modules}));
vi.mock("@/modules/whatsapp-qr/server",()=>({qrCommonGroups:mocks.common,qrGroupInfo:mocks.group}));
import { GET } from "@/app/api/whatsapp/inbox/[conversationId]/details/route";
const agency="11111111-1111-4111-8111-111111111111", id="44444444-4444-4444-8444-444444444444";
let found:boolean, isGroup:boolean, channel:string, mediaError:boolean;
const get=()=>GET(new Request("https://app.example.test/details"),{params:Promise.resolve({conversationId:id})});
beforeEach(()=>{
  vi.clearAllMocks(); found=true;isGroup=false;channel="qr";mediaError=false;
  const supabase=createClient("https://db.example.test","test-key",{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input)=>{
    const url=new URL(String(input));expect(url.searchParams.get("agency_id")).toBe(`eq.${agency}`);
    const body=url.pathname.endsWith("/whatsapp_conversations") ? found?{id,remote_id:"5586999999999",channel,is_group:isGroup}:null : [];
    if(url.pathname.endsWith("/whatsapp_messages"))expect(url.searchParams.get("conversation_id")).toBe(`eq.${id}`);
    return new Response(JSON.stringify(mediaError&&url.pathname.endsWith("/whatsapp_messages")?{message:"error"}:body),{status:mediaError&&url.pathname.endsWith("/whatsapp_messages")?500:200,headers:{"Content-Type":"application/json"}});
  }}});
  mocks.context.mockResolvedValue({supabase,agency:{id:agency},user:{id:agency},role:"viewer"});mocks.modules.mockResolvedValue(["whatsapp"]);
  mocks.common.mockResolvedValue({groups:[{id:"123@g.us",subject:"Equipe"}],incomplete:false});mocks.group.mockResolvedValue({subject:"Equipe",participants:[]});
});
it("queries native common groups only after a scoped conversation lookup",async()=>{
  const response=await get();expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toContain("private");
  expect((await response.json()).commonGroups.groups[0].subject).toBe("Equipe");
  expect(mocks.common).toHaveBeenCalledWith(agency,"5586999999999");expect(mocks.group).not.toHaveBeenCalled();
});
it("never queries the provider for a foreign conversation or excluded module",async()=>{
  found=false;expect((await get()).status).toBe(404);expect(mocks.common).not.toHaveBeenCalled();
  found=true;mocks.modules.mockResolvedValue([]);expect((await get()).status).toBe(403);expect(mocks.common).not.toHaveBeenCalled();
});
it("preserves group information and excludes common-group lookups for groups and Cloud",async()=>{
  isGroup=true;expect((await get()).status).toBe(200);expect(mocks.group).toHaveBeenCalled();expect(mocks.common).not.toHaveBeenCalled();
  isGroup=false;channel="official";expect((await get()).status).toBe(200);expect(mocks.common).not.toHaveBeenCalled();
});
it("represents an unavailable provider as unknown, and stops on media failures",async()=>{
  mocks.common.mockResolvedValue(null);expect((await (await get()).json()).commonGroups).toBeNull();
  vi.clearAllMocks();mediaError=true;expect((await get()).status).toBe(503);expect(mocks.common).not.toHaveBeenCalled();
});
