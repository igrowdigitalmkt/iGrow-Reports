import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), service: vi.fn(), invite: vi.fn(), audit: vi.fn(), client: vi.fn() }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
import { inviteClientPortalUser } from "@/modules/client-portal/actions";

const agencyId = "aaaaaaaa-0000-4000-8000-000000000031";
const clientId = "11111111-0000-4000-8000-000000000031";
const input = { agencyId, clientId, email: "  Cliente@Exemplo.com " };

function clientsQuery() {
  const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: mocks.client };
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ role: "owner", agency: { id: agencyId }, user: { id: "actor" }, supabase: { from: () => clientsQuery() } });
  mocks.client.mockResolvedValue({ data: { id: clientId } });
  mocks.invite.mockResolvedValue({ data: { user: { id: "invited" } }, error: null });
  mocks.service.mockReturnValue({ auth: { admin: { inviteUserByEmail: mocks.invite } }, from: () => ({ insert: mocks.audit }) });
});

it("invites a normalized email through Supabase Auth and records an audit entry", async () => {
  expect(await inviteClientPortalUser(input)).toEqual({ success: true, status: "invited" });
  expect(mocks.invite).toHaveBeenCalledWith("cliente@exemplo.com");
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ agency_id: agencyId, actor_id: "actor", action: "client_portal.invited", entity_id: clientId }));
});

it("reports an existing account without sending another invite", async () => {
  mocks.invite.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", status: 422 } });
  expect(await inviteClientPortalUser(input)).toEqual({ success: true, status: "exists" });
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("restricts invites to owners and administrators before any privileged call", async () => {
  mocks.context.mockResolvedValue({ role: "editor" });
  expect(await inviteClientPortalUser(input)).toHaveProperty("error");
  expect(mocks.service).not.toHaveBeenCalled();
});

it("rejects another agency and archived or foreign clients", async () => {
  expect(await inviteClientPortalUser({ ...input, agencyId: "bbbbbbbb-0000-4000-8000-000000000031" })).toHaveProperty("error");
  mocks.client.mockResolvedValue({ data: null });
  expect(await inviteClientPortalUser(input)).toEqual({ error: "Cliente indisponível ou arquivado." });
  expect(mocks.invite).not.toHaveBeenCalled();
});

it("does not expose provider error details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.invite.mockResolvedValue({ data: { user: null }, error: { code: "over_email_send_rate_limit", status: 429, message: "secret detail" } });
  expect(await inviteClientPortalUser(input)).toEqual({ error: "Não foi possível enviar o convite. Tente novamente mais tarde." });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail");
  log.mockRestore();
});
