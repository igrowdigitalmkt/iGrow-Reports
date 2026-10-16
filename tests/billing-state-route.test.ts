import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const context = { role: "owner", agency: { id: "ag-A" }, supabase: { rpc: vi.fn() } };
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: async () => context }));
import { GET } from "@/app/api/billing/state/route";

const snapshot = { subscription: null, pending_checkout: { status: "awaiting_payment", cycle: "monthly", amount_cents: 4990, expires_at: "2099-01-01T00:00:00Z", dispatched_at: new Date().toISOString() } };
const call = (query = "") => GET(new Request(`https://app.test/api/billing/state${query}`));

describe("acompanhamento leve do retorno do checkout", () => {
  beforeEach(() => { context.role = "owner"; context.supabase.rpc.mockReset(); context.supabase.rpc.mockResolvedValue({ data: snapshot, error: null }); });
  it("faz UMA consulta ao banco (a situação da organização) e devolve só o estado resumido", async () => {
    const response = await call("?e=ok");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "verifying_payment", polling: true });
    expect(context.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(context.supabase.rpc).toHaveBeenCalledWith("get_agency_billing", { p_agency_id: "ag-A" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("administrador consulta; editor e demais recebem 403 sem tocar no banco", async () => {
    context.role = "admin";
    expect((await call()).status).toBe(200);
    context.role = "editor";
    context.supabase.rpc.mockClear();
    expect((await call()).status).toBe(403);
    expect(context.supabase.rpc).not.toHaveBeenCalled();
  });
  it("assinatura ativa encerra o acompanhamento (polling: false)", async () => {
    context.supabase.rpc.mockResolvedValue({ data: { subscription: { status: "active", cycle: "monthly", amount_cents: 4990 } }, error: null });
    expect(await (await call("?e=ok")).json()).toEqual({ state: "confirmed", polling: false });
  });
  it("falha do banco devolve 'indisponível' sem derrubar a tela (a tela segue tentando)", async () => {
    context.supabase.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "x" } });
    expect(await (await call()).json()).toEqual({ state: "unavailable", polling: false });
  });
  it("a dica de retorno é só texto: valor inválido é ignorado", async () => {
    context.supabase.rpc.mockResolvedValue({ data: { last_intent: { status: "expired", at: "2026-10-15T12:00:00Z" } }, error: null });
    expect(((await (await call("?e=<script>")).json()) as { state: string }).state).toBe("expired");
  });
});
