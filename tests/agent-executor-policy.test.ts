import { describe, expect, it } from "vitest";
import { evaluateDelegatedAction, type PolicyInput } from "@/modules/agent-executor/policy";

const agencyId = "10000000-0000-4000-8000-000000000001";
const clientId = "20000000-0000-4000-8000-000000000002";
const actionId = "30000000-0000-4000-8000-000000000003";
const now = new Date("2026-10-18T18:00:00.000Z");

function fixture(action = "pause_campaign"): PolicyInput {
  return {
    now,
    proposal: {
      actionId, action, targetId: "111", adAccountId: "act_123",
      factsCollectedAt: "2026-10-18T17:30:00.000Z",
      rationale: "Pausar a campanha para interromper desperdício confirmado.",
      ...(action.startsWith("set_") ? { dailyBudgetMinor: 5500 } : {}),
    },
    delegation: {
      agencyId, clientId, adAccountId: "act_123",
      enabled: true, revokedAt: null, expiresAt: "2026-10-19T00:00:00.000Z",
      allowedActions: [
        "pause_campaign", "resume_campaign", "set_campaign_daily_budget",
      ],
      maxAccountDailyBudgetMinor: 20_000, maxEntityDailyBudgetMinor: 10_000,
      maxIncreaseMinorPerAction: 5_000, maxIncreasePercentPerAction: 20,
    },
    context: {
      agencyId, clientId, adAccountId: "act_123", currency: "BRL",
      hasWritePermission: true, userMayDelegate: true,
      commercialAccessActive: true, metaConnectionActive: true,
      confirmedActiveDailyBudgetMinor: 12_000, budgetCoverageComplete: true,
    },
    entity: {
      id: "111", adAccountId: "act_123", level: "campaign", configuredStatus: "ACTIVE",
      dailyBudgetMinor: 5_000, fetchedAt: "2026-10-18T17:59:00.000Z",
    },
  };
}

function asObject(value: unknown): Record<string, unknown> { return value as Record<string, unknown>; }

describe("agente executor — política de delegação", () => {
  it("autoriza pausa já delegada, sem gerar operação de rede", () => {
    const result = evaluateDelegatedAction(fixture());
    expect(result).toMatchObject({ ok: true, operation: { action: "pause_campaign", targetId: "111", adAccountId: "act_123" } });
  });
  it.each([
    ["outra agência", (i: PolicyInput) => { asObject(i.context).agencyId = "99999999-0000-4000-8000-000000000009"; }],
    ["outra conta", (i: PolicyInput) => { asObject(i.proposal).adAccountId = "act_987"; }],
    ["outra entidade", (i: PolicyInput) => { asObject(i.proposal).targetId = "222"; }],
    ["sem permissão de escrita", (i: PolicyInput) => { asObject(i.context).hasWritePermission = false; }],
    ["assinatura restrita", (i: PolicyInput) => { asObject(i.context).commercialAccessActive = false; }],
    ["sem poder de delegar", (i: PolicyInput) => { asObject(i.context).userMayDelegate = false; }],
    ["conexão revogada", (i: PolicyInput) => { asObject(i.context).metaConnectionActive = false; }],
    ["delegação revogada", (i: PolicyInput) => { asObject(i.delegation).revokedAt = "2026-10-18T12:00:00Z"; }],
    ["delegação expirada", (i: PolicyInput) => { asObject(i.delegation).expiresAt = "2026-10-18T18:00:00Z"; }],
    ["sem ação permitida", (i: PolicyInput) => { asObject(i.delegation).allowedActions = []; }],
    ["fatos antigos", (i: PolicyInput) => { asObject(i.proposal).factsCollectedAt = "2026-10-17T10:00:00Z"; }],
    ["estado antigo", (i: PolicyInput) => { asObject(i.entity).fetchedAt = "2026-10-18T17:53:00Z"; }],
    ["tipo errado de entidade", (i: PolicyInput) => { asObject(i.entity).level = "adset"; }],
    ["entidade excluída", (i: PolicyInput) => { asObject(i.entity).configuredStatus = "DELETED"; }],
    ["campo inesperado", (i: PolicyInput) => { asObject(i.proposal).token = "unsafe"; }],
  ])("rejeita %s", (_name, mutate) => {
    const input = fixture(); mutate(input);
    expect(evaluateDelegatedAction(input).ok).toBe(false);
  });
  it("nega aumento com cobertura financeira incompleta", () => {
    const i = fixture("set_campaign_daily_budget");
    asObject(i.context).budgetCoverageComplete = false;
    expect(evaluateDelegatedAction(i).ok).toBe(false);
  });
  it("nega aumento acima do percentual delegado e do teto global", () => {
    const i = fixture("set_campaign_daily_budget");
    asObject(i.proposal).dailyBudgetMinor = 6500;
    expect(evaluateDelegatedAction(i).ok).toBe(false);
    asObject(i.proposal).dailyBudgetMinor = 5500;
    asObject(i.delegation).maxAccountDailyBudgetMinor = 12_400;
    expect(evaluateDelegatedAction(i).ok).toBe(false);
  });
  it("autoriza alteração de orçamento com cobertura integral e limites", () => {
    const decision = evaluateDelegatedAction(fixture("set_campaign_daily_budget"));
    expect(decision).toMatchObject({ ok: true, operation: { requestedDailyBudgetMinor: 5500 } });
  });
  it("reativação precisa conhecer orçamento; sem cobertura falha fechado", () => {
    const i = fixture("resume_campaign");
    asObject(i.entity).configuredStatus = "PAUSED";
    asObject(i.entity).dailyBudgetMinor = null;
    expect(evaluateDelegatedAction(i).ok).toBe(false);
    asObject(i.entity).dailyBudgetMinor = 5000;
    expect(evaluateDelegatedAction(i).ok).toBe(true);
  });
  it("não aceita orçamento em ação de status nem ausência em ação de orçamento", () => {
    const i = fixture();
    asObject(i.proposal).dailyBudgetMinor = 20_000;
    expect(evaluateDelegatedAction(i).ok).toBe(false);
    const j = fixture("set_campaign_daily_budget");
    delete asObject(j.proposal).dailyBudgetMinor;
    expect(evaluateDelegatedAction(j).ok).toBe(false);
  });
});
