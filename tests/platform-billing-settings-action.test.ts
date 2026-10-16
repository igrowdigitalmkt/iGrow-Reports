import { beforeEach, describe, expect, it, vi } from "vitest";

// Ação de servidor das Configurações comerciais (Super Admin): autorização, validação e parâmetros enviados ao banco.
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/modules/platform-admin/guard", () => ({ authorizePlatformAction: mocks.authorize }));
import { updateBillingSettingsAction } from "@/modules/platform-admin/commercial/actions";

const VERSION = "e1cccccc-0000-4000-8000-000000000001";
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries({ trialDays: "7", graceDays: "7", checkoutMinutes: "30", trialPlanVersionId: VERSION, ...values })) data.set(key, value); return data; };
const empty = { error: null, ok: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.authorize.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc } });
});

describe("updateBillingSettingsAction", () => {
  it("sem operador autenticado com MFA: nada é enviado ao banco", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Sessão administrativa inválida." });
    expect(await updateBillingSettingsAction(empty, form({}))).toEqual({ error: "Sessão administrativa inválida.", ok: null });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["trialDays", "0"], ["trialDays", "91"], ["graceDays", "-1"], ["graceDays", "61"], ["checkoutMinutes", "9"], ["checkoutMinutes", "1441"], ["trialDays", "abc"], ["trialPlanVersionId", "nao-e-uuid"]])("valor inválido (%s=%s) é recusado no servidor antes do banco", async (field, value) => {
    const result = await updateBillingSettingsAction(empty, form({ [field]: value }));
    expect(result.error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("salva só os quatro parâmetros e NUNCA envia live_enabled", async () => {
    const result = await updateBillingSettingsAction(empty, form({ trialDays: "14", graceDays: "5", checkoutMinutes: "45" }));
    expect(result.ok).toMatch(/Valem para novos testes/);
    expect(mocks.rpc).toHaveBeenCalledWith("platform_update_billing_settings", { p_trial_days: 14, p_trial_plan_version_id: VERSION, p_past_due_grace_days: 5, p_checkout_minutes: 45 });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/live/i);
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/comercial");
  });
  it("plano de teste vazio vira null (teste desativado: cadastros novos nascem restritos)", async () => {
    await updateBillingSettingsAction(empty, form({ trialPlanVersionId: "" }));
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_trial_plan_version_id: null });
  });
  it("recusa do banco (plano público, versão não publicada, sem MFA) volta como mensagem, sem vazar detalhes", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "O plano do teste precisa ser uma versão publicada de um plano privado e não vendável (sem checkout)." } });
    expect((await updateBillingSettingsAction(empty, form({}))).error).toMatch(/privado e não vendável/);
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "interno: detalhe sensível" } });
    const denied = await updateBillingSettingsAction(empty, form({}));
    expect(denied.error).toMatch(/Sem permissão/);
    expect(JSON.stringify(denied)).not.toContain("detalhe sensível");
  });
});
