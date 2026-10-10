import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
import { GET, PATCH, POST, DELETE } from "@/app/api/whatsapp/inbox/native-labels/route";
const agency = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const chat = "44444444-4444-4444-8444-444444444444";
let validChat: boolean, blocked: boolean, unavailable: boolean, invalidState: boolean, role: string;
let writes: Array<{ path: string; body: Record<string, unknown> }>;
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
beforeEach(() => {
  validChat=true; blocked=false; unavailable=false; invalidState=false; role="owner"; writes=[];
  vi.stubEnv("EVOLUTION_API_URL", "https://evo.example.test");
  vi.stubEnv("EVOLUTION_API_KEY", "test-key");
  const supabase = createClient("https://db.example.test", "test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async(input) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("agency_id")).toBe(`eq.${agency}`);
    if (url.pathname.endsWith("/whatsapp_qr_reset_guards")) return reply({ blocked, fresh_after: "2026-10-10T00:00:00Z" });
    if (url.pathname.endsWith("/whatsapp_qr_peer_links")) return reply([{lid:"123456789012@lid",phone:"5586999999999"}]);
    if (url.pathname.endsWith("/whatsapp_conversations")) {
      expect(url.searchParams.get("channel_key")).toBe("eq.qr");
      return reply(validChat ? [{id:chat, remote_id:"5586999999999"}] : []);
    }
    throw Error("Unexpected database table");
  } } });
  mocks.service.mockReturnValue(supabase);
  mocks.context.mockImplementation(async()=>({supabase,agency:{id:agency},user:{id:user},role}));
  vi.stubGlobal("fetch", vi.fn(async(input,init:RequestInit|undefined) => {
    const path = new URL(String(input)).pathname;
    expect(path).toContain(`igrow-${agency}`);
    expect(new Headers(init?.headers).get("apikey")).toBe("test-key");
    if (path.startsWith("/instance/connectionState/")) return reply({instance:{state:"open"}});
    if (path.startsWith("/label/igrowSnapshot/")) return invalidState
      ? reply({response:{message:["IGROW_LABEL_STATE_UNAVAILABLE"]}},400)
      : reply({labels:[{id:"1",name:"\u200eNão lidas",color:"0"},{id:"3",name:"Pagamento pendente",color:"3"}],chats:[{remoteJid:"123456789012@lid",labels:["3"]}]});
    writes.push({path,body:JSON.parse(String(init?.body))});
    return reply(unavailable?{error:"provider rejected"}:{id:"4"},unavailable?500:200);
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const request=(body:unknown,method="PATCH")=>new Request("https://app.example.test/api/whatsapp/inbox/native-labels",{method,body:JSON.stringify(body)});
it("reads the native ID, name, color and proven LID membership",async()=>{
  const response=await GET();
  expect(response.status).toBe(200);
  const body=await response.json();
  expect(body.source).toBe("whatsapp");
  expect(body.lists).toHaveLength(1);
  expect(body.lists[0]).toMatchObject({id:"wa:3",name:"Pagamento pendente",color:"#c15add",conversationIds:[chat]});
  expect(writes).toEqual([]);
});
it("adds and removes the native label on the real peer",async()=>{
  expect((await PATCH(request({id:"wa:3",conversationId:chat,member:true}))).status).toBe(200);
  expect(writes[0].body).toEqual({number:"5586999999999@s.whatsapp.net",labelId:"3",action:"add"});
  expect((await PATCH(request({id:"wa:3",conversationId:chat,member:false}))).status).toBe(200);
  expect(writes[1].body.action).toBe("remove");
});
it("refuses peers from a different agency or number before writing",async()=>{
  validChat=false;
  expect((await PATCH(request({id:"wa:3",conversationId:chat,member:true}))).status).toBe(503);
  expect(writes).toEqual([]);
});
it("creates a native label using the protocol color and returned ID",async()=>{
  const response=await POST(request({name:"Novo cliente",color:"#c0835d",conversationIds:[chat]},"POST"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({id:"wa:4"});
  expect(writes[0].body).toEqual({name:"Novo cliente",color:5});
  expect(writes[1].body.labelId).toBe("4");
  expect((await POST(request({name:"Cinza",color:"#8d9599"},"POST"))).status).toBe(200);
  expect(writes[2].body.color).toBe(21);
});
it("renames and deletes the existing native label",async()=>{
  expect((await PATCH(request({id:"wa:3",name:"Atenção"}))).status).toBe(200);
  expect(writes[0].body).toEqual({id:"3",name:"Atenção",color:3});
  expect((await DELETE(new Request("https://app.example.test/api/whatsapp/inbox/native-labels?id=wa%3A3"))).status).toBe(200);
  expect(writes[1].body).toEqual({number:"123456789012@lid",labelId:"3",action:"remove"});
  expect(writes[2].body).toEqual({id:"3",deleted:true});
});
it("never reports success when WhatsApp refuses the operation",async()=>{
  unavailable=true;
  expect((await PATCH(request({id:"wa:3",conversationId:chat,member:true}))).status).toBe(503);
});
it("asks to reconnect instead of pretending an unreadable WhatsApp state is an empty label list",async()=>{
  invalidState=true;
  const response=await GET();
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Reconecte");
  expect((await PATCH(request({id:"wa:3",conversationId:chat,member:true}))).status).toBe(409);
  expect(writes).toEqual([]);
});
it("protects viewers and blocked pairings",async()=>{
  role="viewer";
  expect((await PATCH(request({id:"wa:3",conversationId:chat,member:true}))).status).toBe(403);
  role="owner";blocked=true;
  expect((await GET()).status).toBe(503);
  expect(writes).toEqual([]);
});
it("rejects local UUIDs and colors unavailable in WhatsApp",async()=>{
  expect((await PATCH(request({id:chat,conversationId:chat,member:true}))).status).toBe(400);
  expect((await POST(request({name:"Lead",color:"#a3297b"},"POST"))).status).toBe(400);
  expect(writes).toEqual([]);
});
