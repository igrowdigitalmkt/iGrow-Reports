import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context: vi.fn(), modules: vi.fn(), block: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("@/modules/team/admin", () => ({ loadOwnModules: mocks.modules }));
vi.mock("@/modules/whatsapp-qr/server", () => ({ qrContactBlock: mocks.block }));
import { GET, POST } from "@/app/api/whatsapp/inbox/[conversationId]/block/route";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
const agency = "11111111-1111-4111-8111-111111111111", id = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ conversationId: id }) };
const get = () => GET(new Request("https://app.example.test/block"), params);
const post = (body: unknown) => POST(new Request("https://app.example.test/block", { method: "POST", body: JSON.stringify(body) }), params);
let found: boolean, group: boolean, channel: string;
beforeEach(() => {
  vi.clearAllMocks(); found = true; group = false; channel = "qr";
  const supabase = createClient("https://db.example.test", "test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const url = new URL(String(input)); expect(url.searchParams.get("agency_id")).toBe(`eq.${agency}`);
    expect(url.searchParams.get("id")).toBe(`eq.${id}`);
    return new Response(JSON.stringify(found ? { id, remote_id: "5586999999999", channel, is_group: group } : null), { headers: { "Content-Type": "application/json" } });
  } } });
  mocks.context.mockResolvedValue({ supabase, agency: { id: agency }, user: { id: agency }, role: "editor" });
  mocks.modules.mockResolvedValue(["whatsapp"]); mocks.block.mockResolvedValue({ blocked: false });
});
it("reads native state and sends explicit idempotent block/unblock after an agency-scoped lookup", async () => {
  const response = await get(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(mocks.block).toHaveBeenLastCalledWith(agency, "5586999999999", undefined);
  mocks.block.mockResolvedValue({ blocked: true }); expect(await (await post({ blocked: true })).json()).toEqual({ blocked: true });
  expect(mocks.block).toHaveBeenLastCalledWith(agency, "5586999999999", true);
  expect((await post({ blocked: false })).status).toBe(200); expect(mocks.block).toHaveBeenLastCalledWith(agency, "5586999999999", false);
});
it("allows viewer queries but rejects viewer mutations and excluded modules before calling WhatsApp", async () => {
  const context = await mocks.context(); mocks.context.mockResolvedValue({ ...context, role: "viewer" });
  expect((await get()).status).toBe(200); mocks.block.mockClear();
  expect((await post({ blocked: true })).status).toBe(403); expect(mocks.block).not.toHaveBeenCalled();
  mocks.modules.mockResolvedValue([]); expect((await get()).status).toBe(403); expect(mocks.block).not.toHaveBeenCalled();
});
it("rejects foreign conversations, groups, Cloud channels and malformed payloads without native calls", async () => {
  found = false; expect((await post({ blocked: true })).status).toBe(404);
  found = true; group = true; expect((await post({ blocked: true })).status).toBe(409);
  group = false; channel = "official"; expect((await get()).status).toBe(409);
  expect((await post({ blocked: "true" })).status).toBe(400); expect((await post({ blocked: true, peer: "other" })).status).toBe(400);
  expect(mocks.block).not.toHaveBeenCalled();
});
it("never reports success when the native operation or verification fails", async () => {
  mocks.block.mockRejectedValue(new Error("native timeout"));
  expect((await post({ blocked: true })).status).toBe(502); expect((await get()).status).toBe(502);
});
it("identifies the connected account from the native provider and refuses self-blocking", async () => {
  mocks.block.mockRejectedValue(new EvolutionError("self", 400, "IGROW_CONTACT_SELF"));
  expect(await (await get()).json()).toEqual({ blocked: false, canBlock: false });
  expect((await post({ blocked: true })).status).toBe(409);
});
