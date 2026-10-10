import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
import { PATCH } from "@/app/api/whatsapp/inbox/lists/route";
const agency = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const list = "33333333-3333-4333-8333-333333333333";
const chat = "44444444-4444-4444-8444-444444444444";
let present = false;
let validChat = true;
let failInsert = false;
let writes: Array<{ method: string; prefer: string; body: unknown; url: URL }>;
beforeEach(() => {
  present = false; validChat = true; failInsert = false; writes = [];
  const supabase = createClient("https://db.example.test", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method || "GET";
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/whatsapp_custom_lists")) return reply({ id: list, channel_key: "qr" });
      if (url.pathname.endsWith("/whatsapp_conversations")) return reply(validChat ? { id: chat } : null);
      if (url.pathname.endsWith("/whatsapp_custom_list_members")) {
        const prefer = new Headers(init?.headers).get("prefer") || "";
        writes.push({ method, prefer, body: init?.body ? JSON.parse(String(init.body)) : null, url });
        if (method === "DELETE") { present = false; return new Response(null, {status:204}); }
        // Same permissions as production: merge-duplicates needs UPDATE, which is not granted.
        if (prefer.includes("merge-duplicates") || failInsert) return reply({ code: "42501", message: "permission denied for table whatsapp_custom_list_members" }, 403);
        expect(prefer).toContain("resolution=ignore-duplicates");
        present = true;
        return new Response(null, {status:201});
      }
      throw new Error(`Unexpected request ${method} ${url.pathname}`);
    } },
  });
  mocks.context.mockResolvedValue({supabase, agency:{id:agency}, user:{id:user}});
});
const call = (member: boolean) => PATCH(new Request("https://app.example.test/api/whatsapp/inbox/lists", {method:"PATCH",body:JSON.stringify({id:list,conversationId:chat,member})}));
it("adds and repeats membership without requiring UPDATE permission", async () => {
  expect((await call(true)).status).toBe(200);
  expect(present).toBe(true);
  expect((await call(true)).status).toBe(200);
  expect(writes).toHaveLength(2);
  expect(writes[0].body).toEqual({agency_id:agency,user_id:user,list_id:list,conversation_id:chat});
  expect(writes[0].url.searchParams.get("on_conflict")).toBe("list_id,conversation_id");
});
it("removes the membership with owner-scoped filters", async () => {
  await call(true);
  expect((await call(false)).status).toBe(200);
  expect(present).toBe(false);
  const removal = writes.at(-1)!;
  expect(removal.method).toBe("DELETE");
  expect(removal.url.searchParams.get("agency_id")).toBe(`eq.${agency}`);
  expect(removal.url.searchParams.get("user_id")).toBe(`eq.${user}`);
});
it("rejects a conversation outside the selected number before writing", async () => {
  validChat = false;
  expect((await call(true)).status).toBe(400);
  expect(writes).toEqual([]);
});
it("does not report success when the database rejects the insertion", async () => {
  failInsert = true;
  expect((await call(true)).status).toBe(503);
  expect(present).toBe(false);
});
