import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context: vi.fn(), modules: vi.fn(), service: vi.fn(), revoke: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("@/modules/team/admin", () => ({ loadOwnModules: mocks.modules }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/whatsapp-qr/server", () => ({ revokeQrSentMessage: mocks.revoke, archiveQrChat: vi.fn(), markQrRead: vi.fn() }));
vi.mock("@/modules/whatsapp/inbox-read", () => ({ loadThread: vi.fn() }));
import { POST } from "@/app/api/whatsapp/inbox/[conversationId]/messages/actions/route";
import { POST as chatAction } from "@/app/api/whatsapp/inbox/[conversationId]/route";
const agency = "11111111-1111-4111-8111-111111111111", chat = "22222222-2222-4222-8222-222222222222";
const incoming = "33333333-3333-4333-8333-333333333333", outgoing = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ conversationId: chat }) };
const writes: unknown[] = [];
let messages: Array<{ id: string; direction: string; external_id: string; sent_at: string; revoked_at: null; body: string }>;
const request = (action: string, messageIds = [incoming]) => new Request("https://app.example.test/actions", { method: "POST", body: JSON.stringify({ action, messageIds }) });
beforeEach(() => {
  vi.clearAllMocks(); writes.length = 0;
  messages = [{ id: incoming, direction: "in", external_id: "REAL_IN", sent_at: new Date().toISOString(), revoked_at: null, body: "Recebida" }];
  const supabase = createClient("https://db.example.test", "test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "POST") { writes.push(JSON.parse(init.body as string)); return new Response("[]", { headers: { "Content-Type": "application/json" } }); }
    expect(url.searchParams.get("agency_id")).toBe(`eq.${agency}`);
    const body = url.pathname.endsWith("/whatsapp_conversations") ? { id: chat, channel: "qr", remote_id: "5586999999999" }
      : url.pathname.endsWith("/whatsapp_messages") ? messages : null;
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  } } });
  mocks.context.mockResolvedValue({ supabase, agency: { id: agency }, user: { id: outgoing }, role: "editor" });
  mocks.modules.mockResolvedValue(["whatsapp"]);
});
it.each(["hide", "revoke"])("refuses %s on incoming messages before any native or database mutation", async action => {
  expect((await POST(request(action), params)).status).toBe(403);
  expect(writes).toEqual([]); expect(mocks.revoke).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
});
it("rejects a mixed selection as a whole, preserving both messages", async () => {
  messages.push({ ...messages[0], id: outgoing, direction: "out" });
  for (const action of ["hide", "revoke"]) expect((await POST(request(action, [incoming, outgoing]), params)).status).toBe(403);
  expect(writes).toEqual([]); expect(mocks.revoke).not.toHaveBeenCalled();
});
it("still permits private deletion of an outgoing message", async () => {
  messages = [{ ...messages[0], id: outgoing, direction: "out" }];
  expect((await POST(request("hide", [outgoing]), params)).status).toBe(200);
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ message_id: outgoing, agency_id: agency, hidden_at: expect.any(String) });
  expect(mocks.revoke).not.toHaveBeenCalled();
});
it("rejects conversation deletion and clear commands in both APIs", async () => {
  for (const action of ["clear", "delete", "deleteConversation"]) {
    expect((await POST(request(action), params)).status).toBe(400);
    expect((await chatAction(request(action), params)).status).toBe(400);
  }
  expect(mocks.context).not.toHaveBeenCalled(); expect(writes).toEqual([]);
});
it("rejects excluded modules before privileged actions", async () => {
  mocks.modules.mockResolvedValue([]);
  expect((await POST(request("revoke", [outgoing]), params)).status).toBe(403);
  expect(mocks.revoke).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
});
