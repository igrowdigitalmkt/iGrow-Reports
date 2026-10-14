import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));

import { parseOperatorStatus, resolvePlatformAccess } from "@/modules/platform-admin/access";
import { authorizePlatformApi, requirePlatformOperator, requirePlatformOperatorForMfa } from "@/modules/platform-admin/guard";
import { startMfaEnrollmentAction, verifyMfaAction } from "@/modules/platform-admin/mfa-actions";
import { safeRedirect } from "@/modules/auth/redirect";

const FACTOR = "11111111-1111-4111-8111-111111111111";
type Setup = { user?: { id: string; email: string } | null; status?: unknown; rpcError?: boolean; verified?: string[]; unverified?: string[]; verifyError?: boolean };

function client(setup: Setup = {}) {
  const user = setup.user === undefined ? { id: "u1", email: "dono@example.test" } : setup.user;
  const verified = (setup.verified ?? []).map((id) => ({ id, factor_type: "totp", status: "verified" }));
  const unverified = (setup.unverified ?? []).map((id) => ({ id, factor_type: "totp", status: "unverified" }));
  const rpc = vi.fn(async (name: string) => name === "platform_operator_status"
    ? { data: setup.status ?? null, error: setup.rpcError ? { code: "XX000" } : null }
    : { data: "audit-id", error: null });
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: user ? null : { message: "no session" } }),
      mfa: {
        listFactors: vi.fn().mockResolvedValue({ data: { all: [...verified, ...unverified], totp: verified }, error: null }),
        unenroll: vi.fn().mockResolvedValue({ data: {}, error: null }),
        enroll: vi.fn().mockResolvedValue({ data: { id: FACTOR, totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "SEGREDO" } }, error: null }),
        challengeAndVerify: vi.fn().mockResolvedValue({ data: {}, error: setup.verifyError ? { message: "invalid" } : null }),
      },
    },
    rpc,
  };
  mocks.createClient.mockResolvedValue(supabase);
  return supabase;
}
const owner = (aal: string) => ({ role: "owner", aal });
const formData = (entries: Record<string, string>) => { const data = new FormData(); Object.entries(entries).forEach(([key, value]) => data.set(key, value)); return data; };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
  mocks.notFound.mockImplementation(() => { throw new Error("NOT_FOUND"); });
});

describe("identificação do operador da plataforma", () => {
  it("só reconhece o formato esperado do banco", () => {
    expect(parseOperatorStatus(owner("aal2"))).toEqual({ role: "owner", aal: "aal2" });
    expect(parseOperatorStatus(owner("aal1"))).toEqual({ role: "owner", aal: "aal1" });
    expect(parseOperatorStatus({ role: "owner", aal: "qualquer" })).toEqual({ role: "owner", aal: "aal1" });
    for (const value of [null, undefined, "owner", [], {}, { role: "admin", aal: "aal2" }, { role: "superuser", aal: "aal2" }]) expect(parseOperatorStatus(value)).toBeNull();
  });

  it("usuário comum e administrador de organização não são operadores", async () => {
    expect((await resolvePlatformAccess(client({ status: null }) as never)).state).toBe("not_operator");
  });
  it("sem sessão válida é não autenticado e nem consulta o banco", async () => {
    const supabase = client({ user: null });
    expect((await resolvePlatformAccess(supabase as never)).state).toBe("unauthenticated");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it("operador sem MFA exige o segundo fator; com MFA validado é liberado", async () => {
    expect((await resolvePlatformAccess(client({ status: owner("aal1") }) as never)).state).toBe("mfa_required");
    const granted = await resolvePlatformAccess(client({ status: owner("aal2") }) as never);
    expect(granted).toMatchObject({ state: "granted", operator: { userId: "u1", role: "owner", aal: "aal2" } });
  });
  it("falha do banco nega o acesso", async () => {
    expect((await resolvePlatformAccess(client({ status: owner("aal2"), rpcError: true }) as never)).state).toBe("error");
  });
});

describe("guarda das páginas do /admin", () => {
  it("usuário comum recebe 404 e visitante vai para o login", async () => {
    client({ status: null });
    await expect(requirePlatformOperator()).rejects.toThrow("NOT_FOUND");
    client({ user: null });
    await expect(requirePlatformOperator()).rejects.toThrow("REDIRECT:/entrar?next=%2Fadmin");
  });
  it("operador sem MFA é levado à tela de MFA; com MFA entra", async () => {
    client({ status: owner("aal1") });
    await expect(requirePlatformOperator()).rejects.toThrow("REDIRECT:/admin/mfa");
    client({ status: owner("aal2") });
    await expect(requirePlatformOperator()).resolves.toMatchObject({ operator: { role: "owner" } });
  });
  it("erro ao verificar nega o acesso em vez de liberar", async () => {
    client({ status: owner("aal2"), rpcError: true });
    await expect(requirePlatformOperator()).rejects.toThrow("Não foi possível verificar");
    mocks.createClient.mockResolvedValue(null);
    await expect(requirePlatformOperator()).rejects.toThrow("REDIRECT:/entrar?estado=nao-configurado");
  });
  it("a tela de MFA aceita aal1, mas não aceita quem não é operador", async () => {
    client({ status: owner("aal1") });
    await expect(requirePlatformOperatorForMfa()).resolves.toMatchObject({ mfaVerified: false });
    client({ status: null });
    await expect(requirePlatformOperatorForMfa()).rejects.toThrow("NOT_FOUND");
  });
});

describe("APIs administrativas", () => {
  async function status(setup: Setup) { client(setup); const result = await authorizePlatformApi(); return result.ok ? 200 : result.response.status; }
  it("responde 401, 404, 403 e 503 conforme o caso, e 200 só com operador com MFA", async () => {
    expect(await status({ user: null })).toBe(401);
    expect(await status({ status: null })).toBe(404);
    expect(await status({ status: owner("aal1") })).toBe(403);
    expect(await status({ status: owner("aal2"), rpcError: true })).toBe(503);
    expect(await status({ status: owner("aal2") })).toBe(200);
  });
  it("respostas de erro não são guardadas em cache", async () => {
    client({ status: null });
    const result = await authorizePlatformApi();
    expect(result.ok ? null : result.response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("fluxo de MFA do operador", () => {
  it("quem só tem a senha não troca o autenticador já cadastrado", async () => {
    const supabase = client({ status: owner("aal1"), verified: [FACTOR] });
    expect(await startMfaEnrollmentAction()).toMatchObject({ error: expect.stringContaining("Já existe") });
    expect(supabase.auth.mfa.enroll).not.toHaveBeenCalled();
  });
  it("primeiro cadastro descarta tentativas abandonadas e devolve QR Code", async () => {
    const supabase = client({ status: owner("aal1"), unverified: ["22222222-2222-4222-8222-222222222222"] });
    expect(await startMfaEnrollmentAction()).toMatchObject({ error: null, factorId: FACTOR, secret: "SEGREDO" });
    expect(supabase.auth.mfa.unenroll).toHaveBeenCalledTimes(1);
  });
  it("não operador não cadastra autenticador por esta ação", async () => {
    const supabase = client({ status: null });
    expect(await startMfaEnrollmentAction()).toEqual({ error: "Acesso não autorizado." });
    expect(supabase.auth.mfa.enroll).not.toHaveBeenCalled();
  });
  it("código correto audita e abre o painel; código errado audita a falha", async () => {
    const ok = client({ status: owner("aal1"), verified: [FACTOR] });
    await expect(verifyMfaAction({ error: null }, formData({ factorId: FACTOR, code: "123456" }))).rejects.toThrow("REDIRECT:/admin");
    expect(ok.rpc).toHaveBeenCalledWith("platform_record_audit", expect.objectContaining({ p_action: "admin.mfa_verified", p_outcome: "success" }));
    const bad = client({ status: owner("aal1"), verified: [FACTOR], verifyError: true });
    expect(await verifyMfaAction({ error: null }, formData({ factorId: FACTOR, code: "000000" }))).toEqual({ error: expect.stringContaining("inválido") });
    expect(bad.rpc).toHaveBeenCalledWith("platform_record_audit", expect.objectContaining({ p_action: "admin.mfa_failed", p_outcome: "failure" }));
  });
  it("primeira validação registra o cadastro do autenticador", async () => {
    const supabase = client({ status: owner("aal1"), unverified: [FACTOR] });
    await expect(verifyMfaAction({ error: null }, formData({ factorId: FACTOR, code: "123456" }))).rejects.toThrow("REDIRECT:/admin");
    expect(supabase.rpc).toHaveBeenCalledWith("platform_record_audit", expect.objectContaining({ p_action: "admin.mfa_enrolled" }));
  });
  it("rejeita código fora do formato e fator que não é do operador", async () => {
    const supabase = client({ status: owner("aal1"), verified: [FACTOR] });
    expect(await verifyMfaAction({ error: null }, formData({ factorId: FACTOR, code: "12ab56" }))).toMatchObject({ error: expect.any(String) });
    expect(await verifyMfaAction({ error: null }, formData({ factorId: "33333333-3333-4333-8333-333333333333", code: "123456" }))).toEqual({ error: expect.stringContaining("não encontrado") });
    expect(supabase.auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });
});

describe("redirecionamento após o login", () => {
  it("permite voltar para /admin, mas não para destinos externos", () => {
    expect(safeRedirect("/admin")).toBe("/admin");
    expect(safeRedirect("/admin/mfa")).toBe("/admin/mfa");
    expect(safeRedirect("//evil.test/admin")).toBe("/dashboard");
    expect(safeRedirect("/administrador")).toBe("/dashboard");
  });
});
