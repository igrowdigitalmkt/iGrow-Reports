import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setSession: vi.fn(), accept: vi.fn(), cookieDelete: vi.fn(), server: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: mocks.cookieDelete }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
vi.mock("@/modules/agencies/context", () => ({ AGENCY_COOKIE: "agency", requireUserSession: vi.fn() }));
vi.mock("@/modules/client-portal/invitations", () => ({ acceptPendingClientInvitations: mocks.accept }));
import { establishLinkSessionAction } from "@/modules/auth/actions";

const tokens = { accessToken: "a".repeat(40), refreshToken: "r".repeat(20) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setSession.mockResolvedValue({ error: null });
  mocks.server.mockResolvedValue({ auth: { setSession: mocks.setSession } });
});

it("validates the link session with Supabase, accepts invitations and sends invites to password setup", async () => {
  expect(await establishLinkSessionAction({ ...tokens, type: "invite" })).toEqual({ redirectTo: "/auth/definir-senha" });
  expect(mocks.setSession).toHaveBeenCalledWith({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  expect(mocks.accept).toHaveBeenCalled();
});

it("sends sign-in links straight to the application", async () => {
  expect(await establishLinkSessionAction({ ...tokens, type: "magiclink" })).toEqual({ redirectTo: "/dashboard" });
});

it("rejects malformed or refused sessions without accepting invitations", async () => {
  expect(await establishLinkSessionAction({ ...tokens, type: "phone_change" })).toHaveProperty("error");
  mocks.setSession.mockResolvedValue({ error: { message: "invalid" } });
  expect(await establishLinkSessionAction({ ...tokens, type: "invite" })).toHaveProperty("error");
  expect(mocks.accept).not.toHaveBeenCalled();
});
