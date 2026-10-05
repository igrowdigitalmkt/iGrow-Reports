import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn(), service: vi.fn(), invite: vi.fn(), otp: vi.fn(), createClient: vi.fn() }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: mocks.context }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: () => ({ url: "https://example.supabase.co", publishableKey: "sb_publishable_x" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { inviteClientPortalUser, revokeClientPortalInvitation } from "@/modules/client-portal/actions";

const agencyId = "aaaaaaaa-0000-4000-8000-000000000031";
const clientId = "11111111-0000-4000-8000-000000000031";
const invitationId = "99999999-0000-4000-8000-000000000031";
const input = { agencyId, clientId, email: "  Cliente@Exemplo.com " };
const registered = (existing_account: boolean, already_active = false) =>
  ({ data: [{ invitation_id: already_active ? null : invitationId, existing_account, already_active }], error: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example/");
  mocks.context.mockResolvedValue({ role: "owner", agency: { id: agencyId }, user: { id: "actor" }, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockImplementation(async (name: string) => name === "invite_client_portal_user" ? registered(false) : { data: null, error: null });
  mocks.invite.mockResolvedValue({ data: { user: { id: "invited" } }, error: null });
  mocks.otp.mockResolvedValue({ data: {}, error: null });
  mocks.service.mockReturnValue({ auth: { admin: { inviteUserByEmail: mocks.invite } } });
  mocks.createClient.mockReturnValue({ auth: { signInWithOtp: mocks.otp } });
});

it("registers the invitation before sending an account invite to a new address", async () => {
  const result = await inviteClientPortalUser(input);
  expect(result).toMatchObject({ success: true, status: "invited", invitation: { id: invitationId, email: "cliente@exemplo.com" } });
  expect(mocks.rpc).toHaveBeenCalledWith("invite_client_portal_user", { p_agency_id: agencyId, p_client_id: clientId, p_email: "cliente@exemplo.com" });
  expect(mocks.invite).toHaveBeenCalledWith("cliente@exemplo.com", { redirectTo: "https://app.example/entrar" });
  expect(mocks.otp).not.toHaveBeenCalled();
});

it("sends a sign-in link, without creating users, to an existing confirmed account", async () => {
  mocks.rpc.mockImplementation(async (name: string) => name === "invite_client_portal_user" ? registered(true) : { data: null, error: null });
  expect(await inviteClientPortalUser(input)).toMatchObject({ success: true, status: "signin_link" });
  expect(mocks.invite).not.toHaveBeenCalled();
  expect(mocks.otp).toHaveBeenCalledWith({ email: "cliente@exemplo.com", options: { shouldCreateUser: false, emailRedirectTo: "https://app.example/entrar" } });
});

it("falls back to a sign-in link when Auth already knows the unconfirmed address", async () => {
  mocks.invite.mockResolvedValue({ data: { user: null }, error: { code: "email_exists", status: 422 } });
  expect(await inviteClientPortalUser(input)).toMatchObject({ success: true, status: "signin_link" });
  expect(mocks.otp).toHaveBeenCalled();
});

it("does not send email when access is already active", async () => {
  mocks.rpc.mockImplementation(async () => registered(true, true));
  expect(await inviteClientPortalUser(input)).toEqual({ success: true, status: "active" });
  expect(mocks.invite).not.toHaveBeenCalled();
  expect(mocks.otp).not.toHaveBeenCalled();
});

it("cancels the registered invitation and hides provider details when the email fails", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.invite.mockResolvedValue({ data: { user: null }, error: { code: "over_email_send_rate_limit", status: 429, message: "secret detail" } });
  expect(await inviteClientPortalUser(input)).toEqual({ error: "Não foi possível enviar o e-mail do convite. Tente novamente em alguns minutos." });
  expect(mocks.rpc).toHaveBeenCalledWith("revoke_client_portal_invitation", { p_agency_id: agencyId, p_invitation_id: invitationId });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret detail");
  log.mockRestore();
});

it("restricts invites to owners and administrators of the session agency", async () => {
  mocks.context.mockResolvedValue({ role: "editor" });
  expect(await inviteClientPortalUser(input)).toHaveProperty("error");
  mocks.context.mockResolvedValue({ role: "owner", agency: { id: agencyId }, supabase: { rpc: mocks.rpc } });
  expect(await inviteClientPortalUser({ ...input, agencyId: "bbbbbbbb-0000-4000-8000-000000000031" })).toHaveProperty("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.service).not.toHaveBeenCalled();
});

it("explains when the invitations migration is missing", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  expect(await inviteClientPortalUser(input)).toEqual({ error: "Os convites ainda não estão disponíveis: a atualização do banco precisa ser aplicada." });
});

it("cancels a pending invitation for the session agency only", async () => {
  expect(await revokeClientPortalInvitation({ agencyId, invitationId })).toEqual({ success: true });
  expect(mocks.rpc).toHaveBeenCalledWith("revoke_client_portal_invitation", { p_agency_id: agencyId, p_invitation_id: invitationId });
  expect(await revokeClientPortalInvitation({ agencyId: "bbbbbbbb-0000-4000-8000-000000000031", invitationId })).toHaveProperty("error");
});
