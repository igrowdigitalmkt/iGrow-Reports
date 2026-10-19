import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const stage = vi.hoisted(() => vi.fn());
vi.mock("@/modules/agent-executor/queue", () => {
  class AgentQueueError extends Error { constructor(readonly code: string) { super(code); } }
  return { AgentQueueError, stageMetaDecision: stage };
});

import { buildDecisionFacts } from "@/modules/agent-executor/decision-facts";
import { SUMMARY_OMITTED, validateModelDecision } from "@/modules/agent-executor/decision-validator";
import { runDecisionEngine, decisionEngineEnabled } from "@/modules/agent-executor/decision-engine";
import { createAnthropicDecisionModel } from "@/modules/agent-executor/anthropic-decision-model";
import { stageValidatedDecisions } from "@/modules/agent-executor/decision-bridge";
import { AgentQueueError } from "@/modules/agent-executor/queue";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";

const NOW = new Date("2026-10-18T12:00:00Z");
const entity = (over: Partial<AnalyticsEntity>): AnalyticsEntity => ({
  key: "k", id: "111", level: "campaign", name: "Campanha A", parentId: null, campaignId: null,
  accountId: "act_9", accountName: "Conta", currency: "BRL", values: { spend: 500, conversions: 2 },
  effectiveStatus: "ACTIVE", ...over,
});
const facts = (budgets?: Map<string, number>) => buildDecisionFacts({
  entities: [
    entity({ id: "111", values: { spend: 500, conversions: 2 } }),
    entity({ id: "222", level: "adset", name: "Conjunto B", parentId: "111", campaignId: "111", values: { spend: 120 } }),
    entity({ id: "333", name: "Campanha pausada", effectiveStatus: "PAUSED", values: { spend: 10 } }),
  ],
  currency: "BRL", periodFrom: "2026-10-01", periodTo: "2026-10-17",
  collectedAt: "2026-10-18T11:30:00Z", budgetsMinor: budgets,
});
const rec = (over: Record<string, unknown> = {}) => ({
  action: "pause_campaign", targetRef: "c1", evidenceRefs: ["c1"], confidence: "medium",
  rationale: "Gasto de 500 com apenas 2 conversoes no periodo.", ...over,
});
const out = (recs: unknown[], summary = "Campanha c1 gastou 500 com poucas conversoes.") => ({ summary, recommendations: recs });

describe("fatos do motor de decisao", () => {
  it("nao expoe ids da Meta nem conta ao modelo e mapeia referencias no servidor", () => {
    const f = facts();
    expect(f.factsText).not.toContain("111");
    expect(f.factsText).not.toContain("act_9");
    expect(f.targets.get("c1")).toMatchObject({ metaId: "111", adAccountId: "act_9", status: "ACTIVE" });
    expect(f.targets.get("a2")?.level).toBe("adset");
    expect(f.targets.get("c3")?.status).toBe("PAUSED");
  });
});

describe("validacao deterministica", () => {
  it("aceita pausa valida e roteia para aprovacao humana", () => {
    const r = validateModelDecision(out([rec()]), facts(), NOW);
    expect(r.ok && r.decision.accepted[0]).toMatchObject({ action: "pause_campaign", routing: "needs_human_approval" });
  });
  it("rejeita campos extras como permissao, id ou aprovacao vindos do modelo", () => {
    for (const extra of [{ agencyId: "x" }, { approved: true }, { targetId: "111" }]) {
      expect(validateModelDecision(out([rec(extra)]), facts(), NOW)).toEqual({ ok: false, reason: "invalid_output" });
    }
  });
  it("rejeita alvo desconhecido, evidencia invalida, nivel errado e estado incompativel", () => {
    const f = facts();
    const reasons = (recs: unknown[]) => {
      const r = validateModelDecision(out(recs), f, NOW);
      return r.ok ? r.decision.rejected.map(x => x.reason) : [r.reason];
    };
    expect(reasons([rec({ targetRef: "c9", evidenceRefs: ["c9"] })])).toEqual(["unknown_target"]);
    expect(reasons([rec({ evidenceRefs: ["a2"] })])).toEqual(["invalid_evidence"]);
    expect(reasons([rec({ action: "pause_adset" })])).toEqual(["level_mismatch"]);
    expect(reasons([rec({ targetRef: "c3", evidenceRefs: ["c3"], rationale: "Pausar campanha ja pausada com gasto de 10." })])).toEqual(["not_active"]);
    expect(reasons([rec({ action: "resume_campaign" })])).toEqual(["not_paused"]);
  });
  it("bloqueia numero inventado na justificativa e no resumo", () => {
    const r = validateModelDecision(out([rec({ rationale: "CPA de 77 acima da meta definida." })]), facts(), NOW);
    expect(r.ok && r.decision.rejected[0]?.reason).toBe("unverified_numbers");
    // Resumo com numero inventado e omitido, sem derrubar recomendacoes validas.
    const withBadSummary = validateModelDecision(out([rec()], "Economia de 9999 prevista."), facts(), NOW);
    expect(withBadSummary.ok && withBadSummary.decision.summary).toBe(SUMMARY_OMITTED);
    expect(withBadSummary.ok && withBadSummary.decision.accepted).toHaveLength(1);
  });
  it("aceita arredondamento de valor confirmado, mas nao numero que nao deriva dos dados", () => {
    const f = buildDecisionFacts({
      entities: [entity({ id: "111", values: { spend: 434.3841, conversions: 2 } })],
      currency: "BRL", periodFrom: "2026-10-01", periodTo: "2026-10-17", collectedAt: "2026-10-18T11:30:00Z",
    });
    const ok = validateModelDecision(out([rec({ rationale: "Gasto de R$ 434,38 com 2 conversoes no periodo." })], "Campanha c1 gastou 434 no periodo."), f, NOW);
    expect(ok.ok && ok.decision.accepted).toHaveLength(1);
    expect(ok.ok && ok.decision.summary).not.toBe(SUMMARY_OMITTED);
    const bad = validateModelDecision(out([rec({ rationale: "Gasto de R$ 435,39 com 2 conversoes no periodo." })]), f, NOW);
    expect(bad.ok && bad.decision.rejected.map(r => r.reason)).toEqual(["unverified_numbers"]);
  });
  it("troca marcadores {ref.metrica} pelo valor real; marcador desconhecido vira dado indisponivel e numero calculado e barrado", () => {
    const f = buildDecisionFacts({
      entities: [entity({ id: "111", values: { spend: 31426.5, conversions: 2 } })],
      currency: "BRL", periodFrom: "2026-10-01", periodTo: "2026-10-17", collectedAt: "2026-10-18T11:30:00Z",
    });
    const ok = validateModelDecision(out([rec({ rationale: "Gasto de {c1.spend} com apenas {c1.conversions} conversoes." })], "Campanha c1 gastou {c1.spend}."), f, NOW);
    expect(ok.ok && ok.decision.accepted[0]?.rationale).toBe("Gasto de 31.426,5 com apenas 2 conversoes.");
    expect(ok.ok && ok.decision.summary).toBe("Campanha c1 gastou 31.426,5.");
    const unknown = validateModelDecision(out([rec({ rationale: "Gasto de {c1.invented} no periodo analisado." })]), f, NOW);
    expect(unknown.ok && unknown.decision.accepted[0]?.rationale).toBe("Gasto de [dado indisponivel] no periodo analisado.");
    expect(f.factsText).toContain('"availableMetrics":["conversions","spend"]');
    const computed = validateModelDecision(out([rec({ rationale: "Custo por resultado de 15713 acima do esperado." })]), f, NOW);
    expect(computed.ok && computed.decision.rejected.map(r => r.reason)).toEqual(["unverified_numbers"]);
  });
  it("resolve chaves com dois-pontos e o periodo anterior", () => {
    const f = buildDecisionFacts({
      entities: [entity({ id: "111", values: { spend: 100, "result:registrations": 7, "action:landing_page_view": 3 } })],
      previousEntities: [entity({ id: "111", values: { "result:registrations": 5 } })],
      currency: "BRL", periodFrom: "2026-10-01", periodTo: "2026-10-17", collectedAt: "2026-10-18T11:30:00Z",
    });
    const r = validateModelDecision(out([rec({ rationale: "Gerou {c1.result:registrations} cadastros contra {c1.previousMetrics.result:registrations} antes, com {c1.action:landing_page_view} visitas." })]), f, NOW);
    expect(r.ok && r.decision.accepted[0]?.rationale).toBe("Gerou 7 cadastros contra 5 antes, com 3 visitas.");
  });
  it("calcula orcamento no servidor e exige orcamento confirmado", () => {
    const rb = rec({ action: "set_campaign_daily_budget", budgetChangePercent: 20, rationale: "Aumentar 20 porcento pois c1 gastou 500." });
    const known = validateModelDecision(out([rb]), facts(new Map([["act_9:111", 10_000]])), NOW);
    expect(known.ok && known.decision.accepted[0]?.dailyBudgetMinor).toBe(12_000);
    const unknown = validateModelDecision(out([rb]), facts(), NOW);
    expect(unknown.ok && unknown.decision.rejected[0]?.reason).toBe("budget_unknown");
    const missing = validateModelDecision(out([rec({ action: "set_campaign_daily_budget" })]), facts(new Map([["act_9:111", 10_000]])), NOW);
    expect(missing.ok && missing.decision.rejected[0]?.reason).toBe("budget_mismatch");
  });
  it("impede duas acoes na mesma entidade e registra no_action como observacao", () => {
    const r = validateModelDecision(out([rec(), rec({ rationale: "Segunda pausa para c1 com gasto de 500." }),
      rec({ action: "no_action", targetRef: "a2", evidenceRefs: ["a2"], rationale: "Conjunto a2 com gasto de 120 sem sinal claro." })]), facts(), NOW);
    expect(r.ok && r.decision.rejected.map(x => x.reason)).toEqual(["conflicting_action"]);
    expect(r.ok && r.decision.observations).toHaveLength(1);
  });
  it("recusa fatos desatualizados", () => {
    expect(validateModelDecision(out([rec()]), facts(), new Date("2026-10-18T14:00:00Z"))).toMatchObject({ ok: false, reason: "stale_facts" });
  });
});

describe("motor", () => {
  const model = (output: unknown) => ({ decide: vi.fn(async () => ({ output, usage: { inputTokens: 10, outputTokens: 5 } })) });
  it("fica desligado por padrao e nao chama o modelo", async () => {
    const m = model(out([]));
    expect(decisionEngineEnabled({})).toBe(false);
    expect(await runDecisionEngine({ model: m, enabled: false }, facts(), NOW)).toEqual({ ok: false, reason: "disabled" });
    expect(m.decide).not.toHaveBeenCalled();
  });
  it("trata falha do modelo e saida invalida sem lancar", async () => {
    expect(await runDecisionEngine({ model: { decide: async () => { throw new Error("x"); } }, enabled: true }, facts(), NOW))
      .toEqual({ ok: false, reason: "model_error" });
    expect(await runDecisionEngine({ model: model({ lixo: 1 }), enabled: true }, facts(), NOW))
      .toEqual({ ok: false, reason: "invalid_output" });
  });
  it("informa apenas codigos seguros do provedor, nunca mensagens livres", async () => {
    const safe = await runDecisionEngine({ model: { decide: async () => { throw new Error("anthropic_http_401"); } }, enabled: true }, facts(), NOW);
    expect(safe).toEqual({ ok: false, reason: "model_error", detail: "anthropic_http_401" });
    const leaky = await runDecisionEngine({ model: { decide: async () => { throw new Error("401 invalid x-api-key sk-ant-123"); } }, enabled: true }, facts(), NOW);
    expect(leaky).toEqual({ ok: false, reason: "model_error" });
  });
  it("devolve decisao validada com uso de tokens", async () => {
    const r = await runDecisionEngine({ model: model(out([rec()])), enabled: true }, facts(), NOW);
    expect(r.ok && r.decision.accepted).toHaveLength(1);
    expect(r.ok && r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});

describe("provedor Anthropic", () => {
  const call = (resp: object) => createAnthropicDecisionModel({ messages: { create: vi.fn(async () => resp as never) } });
  it("nao forca tool_choice (Sonnet 5.5 rejeita com 400) e instrui o uso da ferramenta no prompt", async () => {
    const create = vi.fn(async () => ({ stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", name: "submit_decision", input: {} }] }) as never);
    await createAnthropicDecisionModel({ messages: { create } }).decide({ system: "base", factsText: "{}" });
    const params = (create.mock.calls[0] as unknown as [{ tool_choice: { type: string }; system: string; model: string }])[0];
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.system).toContain("submit_decision");
    expect(JSON.stringify(params)).not.toMatch(/"type":"(tool|any)"/);
  });
  it("exige tool use estruturado", async () => {
    const ok = await call({ stop_reason: "tool_use", usage: { input_tokens: 3, output_tokens: 4 },
      content: [{ type: "tool_use", name: "submit_decision", input: { a: 1 } }] }).decide({ system: "s", factsText: "{}" });
    expect(ok.output).toEqual({ a: 1 });
    await expect(call({ stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "pause tudo" }] })
      .decide({ system: "s", factsText: "{}" })).rejects.toThrow("no_structured_output");
    await expect(createAnthropicDecisionModel({ messages: { create: vi.fn(async () => { throw new Error("boom"); }) } })
      .decide({ system: "s", factsText: "{}" })).rejects.toThrow("anthropic_http_network");
  });
});

describe("ponte para a fila", () => {
  const scope = { agencyId: "a", clientId: "c", observationId: "o", factsCollectedAt: "2026-10-18T11:30:00Z" };
  it("pausa e orcamento viram jobs aguardando aprovacao, com valor calculado no servidor", async () => {
    stage.mockReset().mockResolvedValue({ id: "job1", deduplicated: false });
    const f = facts(new Map([["act_9:111", 10_000], ["act_9:222", 5_000]]));
    const r = validateModelDecision(out([rec(),
      rec({ action: "set_adset_daily_budget", targetRef: "a2", evidenceRefs: ["a2"], budgetChangePercent: 10, rationale: "Aumentar 10 porcento em a2 com gasto de 120." })]), f, NOW);
    if (!r.ok) throw new Error("invalid");
    const res = await stageValidatedDecisions({} as never, scope, r.decision, NOW);
    expect(res).toEqual([
      { ref: "c1", status: "awaiting_approval", jobId: "job1", deduplicated: false },
      { ref: "a2", status: "awaiting_approval", jobId: "job1", deduplicated: false },
    ]);
    expect(stage).toHaveBeenCalledTimes(2);
    expect(stage.mock.calls[1]![2]).toMatchObject({ action: "set_adset_daily_budget", targetId: "222", dailyBudgetMinor: 5_500 });
    expect(stage.mock.calls[0]![2]).toEqual({ action: "pause_campaign", targetId: "111", rationale: expect.any(String) });
  });
  it("bloqueio da fila vira resultado, nao excecao", async () => {
    stage.mockReset().mockRejectedValue(new AgentQueueError("commercial_gate"));
    const r = validateModelDecision(out([rec()]), facts(), NOW);
    if (!r.ok) throw new Error("invalid");
    expect(await stageValidatedDecisions({} as never, scope, r.decision, NOW))
      .toEqual([{ ref: "c1", status: "blocked", reason: "commercial_gate" }]);
  });
});
