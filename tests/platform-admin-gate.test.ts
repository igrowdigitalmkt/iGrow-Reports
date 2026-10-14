import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ADMIN_NOT_FOUND_PATH, gateAdminRequest } from "@/modules/platform-admin/proxy-gate";

function setup(path: string, opts: { user?: boolean; status?: unknown; fail?: boolean } = {}) {
  const supabase = {
    auth: { getUser: opts.fail ? vi.fn().mockRejectedValue(new Error("rede")) : vi.fn().mockResolvedValue({ data: { user: opts.user === false ? null : { id: "u1", email: "a@example.test" } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: opts.status ?? null, error: null }),
  };
  const request = { nextUrl: new URL(`https://app.test${path}`), url: `https://app.test${path}` } as unknown as NextRequest;
  return gateAdminRequest(supabase as never, request);
}

describe("primeira camada do /admin (status HTTP)", () => {
  it("quem não é operador recebe reescrita para uma rota inexistente (404 real)", async () => {
    const response = await setup("/admin");
    expect(response?.headers.get("x-middleware-rewrite")).toBe(`https://app.test${ADMIN_NOT_FOUND_PATH}`);
  });
  it("visitante sem sessão vai ao login", async () => {
    const response = await setup("/admin/mfa", { user: false });
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://app.test/entrar?next=%2Fadmin%2Fmfa");
  });
  it("operador sem MFA é levado à tela de MFA, que continua acessível", async () => {
    const response = await setup("/admin", { status: { role: "owner", aal: "aal1" } });
    expect(response?.headers.get("location")).toBe("https://app.test/admin/mfa");
    expect(await setup("/admin/mfa", { status: { role: "owner", aal: "aal1" } })).toBeNull();
  });
  it("operador com MFA passa; falha inesperada segue para as guardas do servidor", async () => {
    expect(await setup("/admin", { status: { role: "owner", aal: "aal2" } })).toBeNull();
    expect(await setup("/admin", { fail: true })).toBeNull();
  });
});
