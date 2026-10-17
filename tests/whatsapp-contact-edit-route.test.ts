import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ context: vi.fn(), modules: vi.fn(), contact: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("@/modules/team/admin", () => ({ loadOwnModules: mocks.modules }));
vi.mock("@/modules/whatsapp-qr/server", () => ({ qrContact: mocks.contact }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
import { GET, PATCH } from "@/app/api/whatsapp/inbox/[conversationId]/contact/route";
import { EvolutionError } from "@/modules/whatsapp-qr/evolution";
const agency = "11111111-1111-4111-8111-111111111111", id = "44444444-4444-4444-8444-444444444444";
const params = { params: Promise.resolve({ conversationId: id }) };
const get = () => GET(new Request("https://app.example.test/contact"), params);
const patch = (body: unknown) => PATCH(new Request("https://app.example.test/contact", { method: "PATCH", body: JSON.stringify(body) }), params);
const edit = { fullName: "Novo ❤️", firstName: "Novo", expectedFullName: "Antigo" };
let found: boolean, group: boolean, channel: string;
let writes: unknown[];
beforeEach(() => {
  vi.clearAllMocks(); found = true; group = false; channel = "qr"; writes = [];
  const client = createClient("https://db.example.test", "test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); expect(url.searchParams.get("agency_id")).toBe(`eq.${agency}`); expect(url.searchParams.get("id")).toBe(`eq.${id}`);
    if (init?.method === "PATCH") {
      expect(url.searchParams.get("channel")).toBe("eq.qr"); expect(url.searchParams.get("is_group")).toBe("eq.false");
      writes.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify([{ id }]), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(found ? { id, remote_id: "5586999999999", channel, is_group: group } : null), { headers: { "Content-Type": "application/json" } });
  } } });
  mocks.context.mockResolvedValue({ supabase: client, agency: { id: agency }, user: { id: agency }, role: "editor" });
  mocks.modules.mockResolvedValue(["whatsapp"]); mocks.service.mockReturnValue(client);
  mocks.contact.mockImplementation(async (_agency, _peer, change) => ({ fullName: change?.fullName ?? "Antigo", firstName: change?.firstName ?? "Antigo", canEdit: true }));
});
it("reads privately without writes and updates only the scoped conversation after native confirmation", async () => {
  const response = await get(); expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store"); expect(writes).toEqual([]);
  expect((await patch(edit)).status).toBe(200); expect(mocks.contact).toHaveBeenLastCalledWith(agency, "5586999999999", edit);
  expect(writes).toEqual([expect.objectContaining({ title: "Novo ❤️" })]);
});
it("blocks missing module access and viewer writes before native or privileged access", async () => {
  mocks.modules.mockResolvedValue([]); expect((await patch(edit)).status).toBe(403); expect((await get()).status).toBe(403);
  mocks.modules.mockResolvedValue(["whatsapp"]); (await mocks.context()).role = "viewer";
  expect((await patch(edit)).status).toBe(403); expect(mocks.contact).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
  expect(await (await get()).json()).toMatchObject({ canEdit: false });
});
it("rejects foreign conversations, groups, Cloud API and attempts to change identities or remove names", async () => {
  found = false; expect((await patch(edit)).status).toBe(404); found = true; group = true; expect((await patch(edit)).status).toBe(409);
  group = false; channel = "official"; expect((await get()).status).toBe(409);
  expect((await patch({ ...edit, peer: "other" })).status).toBe(400); expect((await patch({ ...edit, fullName: " " })).status).toBe(400);
  expect((await patch({ ...edit, fullName: "a\nb" })).status).toBe(400);
  expect(mocks.contact).not.toHaveBeenCalled(); expect(writes).toEqual([]);
});
it("does not update the projection after native conflicts or errors and explains partial projection failure", async () => {
  mocks.contact.mockRejectedValue(new EvolutionError("changed", 400, "IGROW_CONTACT_CHANGED")); expect((await patch(edit)).status).toBe(409);
  mocks.contact.mockRejectedValue(new Error("timeout")); expect((await patch(edit)).status).toBe(502); expect(writes).toEqual([]);
  mocks.contact.mockResolvedValue({ fullName: edit.fullName, firstName: edit.firstName, canEdit: true }); mocks.service.mockReturnValue(null);
  const response = await patch(edit); expect(response.status).toBe(503); expect((await response.json()).error).toContain("atualização no Groow Ads está pendente");
});
