import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/modules/platform-admin/guard", () => ({ authorizePlatformAction: mocks.authorize }));

import { assignPlanAction, createPlanAction, grantOverrideAction, saveDraftAction, setFeatureSwitchAction } from "@/modules/platform-admin/commercial/actions";
import { centsToInput, describeEntitlement, formatBrl, parseMoneyToCents, planDetailSchema, planKeySchema } from "@/modules/platform-admin/commercial/format";

const PLAN = "11111111-1111-4111-8111-111111111111";
const AGENCY = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const defs = [
  { key: "ai_assistant", kind: "feature", label: "Inteligência artificial" },
  { key: "client_portal", kind: "feature", label: "Portal do cliente" },
  { key: "clients", kind: "limit", label: "Clientes ativos" },
  { key: "ai_budget_usd_cents", kind: "limit", label: "Orçamento mensal de IA" },
];
const form = (entries: Record<string, string>) => { const data = new FormData(); Object.entries(entries).forEach(([key, value]) => data.set(key, value)); return data; };
const empty = { error: null, ok: null };

function operator(overrides: Record<string, unknown> = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "platform_list_definitions") return { data: defs, error: null };
    if (name === "platform_create_plan") return { data: PLAN, error: null };
    if (name === "platform_publish_draft") return { data: 2, error: null };
    if (name === "platform_assign_plan") return { data: { over_limit: [{ label: "Clientes ativos", used: 5, limit: 2 }] }, error: null };
    return { data: null, error: null, ...overrides };
  });
  mocks.authorize.mockResolvedValue({ ok: true, supabase: { rpc }, operator: { role: "owner" } });
  return rpc;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
});

describe("formatação e leitura de valores comerciais", () => {
  it("converte preços digitados em centavos e recusa formatos inválidos", () => {
    expect(parseMoneyToCents("49,90")).toBe(4990);
    expect(parseMoneyToCents("R$ 1.5")).toBe(150);
    expect(parseMoneyToCents("")).toBeNull();
    for (const bad of ["abc", "-5", "1,234", "10,5,1", "99999999"]) expect(parseMoneyToCents(bad)).toBeUndefined();
    expect(centsToInput(4990)).toBe("49,90");
    expect(formatBrl(null)).toBe("Não oferecido");
  });
  it("descreve os direitos de forma compreensível", () => {
    expect(describeEntitlement({ key: "clients", kind: "limit", enabled: false, limit_value: 10, unlimited: false })).toBe("até 10");
    expect(describeEntitlement({ key: "clients", kind: "limit", enabled: false, limit_value: 0, unlimited: false })).toBe("Não incluso");
    expect(describeEntitlement({ key: "clients", kind: "limit", enabled: false, limit_value: null, unlimited: true })).toBe("Ilimitado");
    expect(describeEntitlement({ key: "ai_assistant", kind: "feature", enabled: true, limit_value: null, unlimited: false })).toBe("Incluso");
    expect(describeEntitlement({ key: "ai_budget_usd_cents", kind: "limit", enabled: false, limit_value: 500, unlimited: false })).toContain("5,00");
  });
  it("valida o identificador do plano e o formato devolvido pelo banco", () => {
    expect(planKeySchema.safeParse("Basico_2").success).toBe(true);
    for (const bad of ["x", "1plano", "com espaço", "a".repeat(41)]) expect(planKeySchema.safeParse(bad).success).toBe(false);
    expect(planDetailSchema.safeParse({ plan: { id: PLAN, key: "a", name: "A", description: "", visibility: "public", sellable: false, recommended: false, sort_order: 1, current_version_id: null }, versions: [] }).success).toBe(true);
    expect(planDetailSchema.safeParse({ plan: {}, versions: [] }).success).toBe(false);
  });
});

describe("ações administrativas do catálogo comercial", () => {
  it("toda ação reconfere o operador com MFA e não chama o banco sem ele", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Acesso não autorizado." });
    for (const run of [
      () => createPlanAction(empty, form({ key: "basico", name: "Básico", visibility: "public" })),
      () => saveDraftAction(empty, form({ planId: PLAN })),
      () => setFeatureSwitchAction(empty, form({ key: "client_portal", enable: "0", reason: "teste", confirm: "on" })),
      () => assignPlanAction(empty, form({ agencyId: AGENCY, versionId: VERSION })),
      () => grantOverrideAction(empty, form({ agencyId: AGENCY, key: "clients", reason: "teste" })),
    ]) expect(await run()).toEqual({ error: "Acesso não autorizado.", ok: null });
  });

  it("cria o plano e abre a página dele; recusa dados inválidos antes de chamar o banco", async () => {
    const rpc = operator();
    expect(await createPlanAction(empty, form({ key: "1ruim", name: "Básico", visibility: "public" }))).toMatchObject({ error: expect.any(String) });
    expect(await createPlanAction(empty, form({ key: "basico", name: "B", visibility: "public" }))).toMatchObject({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
    await expect(createPlanAction(empty, form({ key: "Basico", name: "Básico", visibility: "private", description: "x" }))).rejects.toThrow(`REDIRECT:/admin/planos/${PLAN}`);
    expect(rpc).toHaveBeenCalledWith("platform_create_plan", { p_key: "basico", p_name: "Básico", p_description: "x", p_visibility: "private" });
  });

  it("monta o rascunho com preços em centavos e só os recursos marcados; publica quando pedido", async () => {
    const rpc = operator();
    const result = await saveDraftAction(empty, form({
      planId: PLAN, priceMonthly: "99,90", priceYearly: "", trialDays: "14", ent_ai_assistant: "on", mode_clients: "limit", limit_clients: "10",
      mode_ai_budget_usd_cents: "limit", limit_ai_budget_usd_cents: "5,00", intent: "publish",
    }));
    expect(result.ok).toContain("Versão 2 publicada");
    expect(rpc).toHaveBeenCalledWith("platform_save_draft", { p_plan_id: PLAN, p_trial_days: 14, p_price_monthly_cents: 9990, p_price_yearly_cents: null,
      p_entitlements: [{ key: "ai_assistant", enabled: true }, { key: "clients", limit: 10 }, { key: "ai_budget_usd_cents", limit: 500 }] });
    expect(rpc).toHaveBeenCalledWith("platform_publish_draft", { p_plan_id: PLAN });
  });

  it("salvar não publica; limites e preços inválidos são recusados", async () => {
    const rpc = operator();
    expect((await saveDraftAction(empty, form({ planId: PLAN, intent: "save", mode_clients: "unlimited" }))).ok).toContain("só vale depois de publicado");
    expect(rpc).not.toHaveBeenCalledWith("platform_publish_draft", expect.anything());
    expect(await saveDraftAction(empty, form({ planId: PLAN, mode_clients: "limit", limit_clients: "dez" }))).toMatchObject({ error: expect.stringContaining("Clientes ativos") });
    expect(await saveDraftAction(empty, form({ planId: PLAN, priceMonthly: "barato" }))).toMatchObject({ error: expect.stringContaining("Preço inválido") });
    expect(await saveDraftAction(empty, form({ planId: PLAN, trialDays: "120" }))).toMatchObject({ error: expect.stringContaining("0 a 90") });
  });

  it("desativação global exige confirmação e motivo; reativar não exige", async () => {
    const rpc = operator();
    expect(await setFeatureSwitchAction(empty, form({ key: "client_portal", enable: "0", reason: "incidente" }))).toMatchObject({ error: expect.stringContaining("confirmação") });
    expect(rpc).not.toHaveBeenCalled();
    expect((await setFeatureSwitchAction(empty, form({ key: "client_portal", enable: "0", reason: "incidente", confirm: "on" }))).ok).toContain("desativada");
    expect(rpc).toHaveBeenCalledWith("platform_set_feature_switch", { p_key: "client_portal", p_enabled: false, p_reason: "incidente" });
    expect((await setFeatureSwitchAction(empty, form({ key: "client_portal", enable: "1" }))).ok).toContain("reativada");
  });

  it("concessão de plano exige motivo e avisa o que já excede o limite, sem remover nada", async () => {
    const rpc = operator();
    expect(await assignPlanAction(empty, form({ agencyId: AGENCY, versionId: VERSION }))).toMatchObject({ error: expect.stringContaining("motivo") });
    expect(rpc).not.toHaveBeenCalled();
    const result = await assignPlanAction(empty, form({ agencyId: AGENCY, versionId: VERSION, note: "parceiro" }));
    expect(result.ok).toContain("Clientes ativos 5/2");
    expect(result.ok).toContain("nada foi removido");
  });

  it("monta a concessão conforme o tipo do recurso e exige motivo", async () => {
    const rpc = operator();
    expect(await grantOverrideAction(empty, form({ agencyId: AGENCY, key: "clients", limitValue: "10", reason: "" }))).toMatchObject({ error: expect.stringContaining("motivo") });
    expect((await grantOverrideAction(empty, form({ agencyId: AGENCY, key: "clients", limitValue: "10", reason: "Parceiro", until: "2026-12-31" }))).ok).toContain("registrada");
    expect(rpc).toHaveBeenCalledWith("platform_grant_override", { p_agency_id: AGENCY, p_key: "clients", p_enabled: null, p_limit: 10, p_unlimited: false, p_expires_at: "2026-12-31T23:59:59-03:00", p_reason: "Parceiro" });
    await grantOverrideAction(empty, form({ agencyId: AGENCY, key: "client_portal", featureValue: "block", reason: "Bloqueio preventivo" }));
    expect(rpc).toHaveBeenLastCalledWith("platform_grant_override", expect.objectContaining({ p_key: "client_portal", p_enabled: false, p_limit: null, p_unlimited: false, p_expires_at: null }));
    await grantOverrideAction(empty, form({ agencyId: AGENCY, key: "clients", limitMode: "unlimited", reason: "Cortesia" }));
    expect(rpc).toHaveBeenLastCalledWith("platform_grant_override", expect.objectContaining({ p_unlimited: true, p_limit: null }));
    expect(await grantOverrideAction(empty, form({ agencyId: AGENCY, key: "clients", reason: "Cortesia" }))).toMatchObject({ error: expect.stringContaining("limite") });
  });

  it("traduz erros do banco sem expor detalhes internos", async () => {
    operator({ error: { code: "XX000", message: "detalhe interno secreto" } });
    const result = await saveDraftAction(empty, form({ planId: PLAN }));
    expect(result.error).toBe("Não foi possível concluir. Tente novamente.");
    expect(JSON.stringify(result)).not.toContain("secreto");
  });
});

import { planRestrictionMessage } from "@/modules/commercial/limit-message";

describe("mensagens de restrição do plano nas telas da organização", () => {
  it("mostra só mensagens de limite e de recurso fora do plano; o resto mantém o texto genérico", () => {
    expect(planRestrictionMessage({ code: "53400", message: "Limite do plano atingido: clientes ativos (máximo 2). Fale com o suporte para ampliar." })).toContain("máximo 2");
    expect(planRestrictionMessage({ code: "42501", message: "Recurso indisponível no plano desta organização: portal do cliente." })).toContain("portal do cliente");
    for (const error of [null, undefined, {}, { code: "42501", message: "permission denied for table x" }, { code: "53400", message: "too many connections" }, { code: "23505", message: "Limite do plano atingido" }]) {
      expect(planRestrictionMessage(error)).toBeNull();
    }
  });
});
