import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
  redirected: null as string | null,
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { mocks.redirected = to; throw new Error("REDIRECT:" + to); } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims: mocks.getClaims, getUser: mocks.getUser } }),
}));

import { claimsAreEnough, requireUserSession, requireViewSession } from "@/modules/agencies/context";

beforeEach(() => {
  mocks.getClaims.mockReset(); mocks.getUser.mockReset(); mocks.redirected = null;
});

describe("quando o crachá da sessão basta", () => {
  it("só com senha já definida ou login por senha", () => {
    expect(claimsAreEnough({ app_metadata: { password_set: true } })).toBe(true);
    expect(claimsAreEnough({ amr: [{ method: "password" }] })).toBe(true);
    expect(claimsAreEnough({ amr: [{ method: "otp" }] })).toBe(false);
    expect(claimsAreEnough({ amr: [{ method: "oauth" }], app_metadata: {} })).toBe(false);
    expect(claimsAreEnough({})).toBe(false);
  });
});

describe("sessão das telas de visualização", () => {
  it("usa o crachá e NÃO consulta o serviço de login quando basta", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", email: "a@b.com", user_metadata: { full_name: "Ana" }, app_metadata: {}, amr: [{ method: "password" }] } }, error: null });
    const session = await requireViewSession("/clientes");
    expect(session.user).toMatchObject({ id: "u1", email: "a@b.com", user_metadata: { full_name: "Ana" } });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("sem sinal de senha definida, confirma no serviço de login (convite, código, Google)", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "otp" }] } }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com", invited_at: "2026-11-01T00:00:00Z", app_metadata: {} } }, error: null });
    const session = await requireViewSession();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(session.user.id).toBe("u1");
  });
  it("crachá inválido ou vencido: confirma no serviço de login e, se recusar, manda entrar", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: { message: "jwt expired" } });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    await expect(requireViewSession("/clientes")).rejects.toThrow("REDIRECT:/entrar?next=%2Fclientes");
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });
});

describe("ações e rotas continuam com a confirmação completa", () => {
  it("requireUserSession nunca usa o crachá", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "u1", amr: [{ method: "password" }] } }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.com", app_metadata: {} } }, error: null });
    const session = await requireUserSession();
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(session.user.id).toBe("u1");
  });
  it("usuário removido ou bloqueado é recusado na hora nas ações", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "User from sub claim in JWT does not exist" } });
    await expect(requireUserSession("/clientes")).rejects.toThrow("REDIRECT:/entrar");
  });
});
