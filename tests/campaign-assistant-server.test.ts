import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { handleAssistantRequest, unavailableModel, type AssistantDeps, type AssistantModel, type AssistantSession, type ModelResult } from "@/modules/campaigns/assistant/server/handler";
import { evaluateChatGate, readGateConfig, CAMPAIGN_CHAT_FEATURE, type GateConfig } from "@/modules/campaigns/assistant/server/gate";
import { askRequestSchema, buildAskRequest } from "@/modules/campaigns/assistant/request";
import { resolveContext } from "@/modules/campaigns/assistant/context";
import type { ReserveResult } from "@/modules/ai/reservation";
import { campaignsData, IDS } from "./campaign-assistant-fixtures";

const NOW = Date.parse("2026-10-19T15:00:00Z");
const session: AssistantSession = { agency: { id: IDS.org, name: "Org", timezone: "America/Sao_Paulo" }, role: "editor", userId: "user-1" };
const allowed: GateConfig = { enabledByOperator: true, featureRegistered: true, reservationsReady: true, accountingHealthy: true, modelConfigured: true, commercial: { allowed: true, budgetUsd: null, restricted: false }, agencyEnabled: true, clientEnabled: true, agencyBudgetUsd: null, monthCostUsd: 0, estimatedCallCostUsd: 0.05 };
const period = { dateFrom: "2026-09-19", dateTo: "2026-10-18" };
const ALL = { level: "client" as const, accountIds: [IDS.accA, IDS.accB] };
let requestCounter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++requestCounter).padStart(12, "0")}`;
const base = { get requestId() { return nextId(); }, clientId: IDS.client, platform: "meta" as const, period, question: "Analise o desempenho desta campanha.", history: [] };
const usage = { inputTokens: 1000, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0, requestId: "req_1", model: "claude-sonnet-5-5" };
const model = (text: string): AssistantModel => ({ configured: true, generate: vi.fn(async (): Promise<ModelResult> => ({ ok: true, text, usage })) });

/** Simula o servidor de dados: devolve exatamente as contas pedidas que estiverem vinculadas (contas fora do vínculo são ignoradas). */
const loadFromRequest = vi.fn(async (_client: string, query: { contas?: string }) => {
  const data = campaignsData();
  const asked = (query.contas ?? "").split(",").filter(Boolean);
  const selected = asked.length ? data.selectedAccountIds.filter(id => asked.includes(id)) : data.selectedAccountIds;
  return { ...data, selectedAccountIds: selected, rows: data.rows.filter(row => selected.includes(row.accountId)) };
});

const reserved = { ok: true as const, usageId: "usage-1", monthCostUsd: 0.1, budgetUsd: 5 };
function makeDeps(over: Partial<AssistantDeps> = {}) {
  const calls = {
    loadData: vi.fn(loadFromRequest), readGate: vi.fn(async () => allowed), reserveUsage: vi.fn(async (): Promise<ReserveResult> => reserved), settleUsage: vi.fn(async () => true),
    release: vi.fn(), acquireSlot: vi.fn(() => calls.release), claimRequest: vi.fn(() => true),
  };
  const deps: AssistantDeps = {
    getSession: async () => ({ ok: true, session }), canOpenCampaigns: async () => true,
    findClient: async (s, id) => (s.agency.id === IDS.org && id === IDS.client ? { id, name: "Colégio Exemplo" } : null),
    loadData: calls.loadData as AssistantDeps["loadData"], readGate: calls.readGate, reserveUsage: calls.reserveUsage, settleUsage: calls.settleUsage,
    acquireSlot: calls.acquireSlot, claimRequest: calls.claimRequest, model: model("Resposta."), now: () => NOW, ...over,
  };
  return { deps, calls };
}

describe("contrato da solicitação", () => {
  it("aceita só identificadores e rejeita organização ou contexto vindos do navegador", () => {
    expect(askRequestSchema.safeParse({ ...base, target: ALL }).success).toBe(true);
    expect(askRequestSchema.safeParse({ ...base, target: ALL, organizationId: IDS.org }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, target: ALL, context: { level: "client" } }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, target: { level: "client" } }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, target: { level: "client", accountIds: [] } }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, target: { level: "client", accountIds: ["x"] } }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, target: { level: "campaign", entityId: "100" } }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, target: { level: "ad", accountId: IDS.accA, entityId: "abc" } }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, clientId: "nao-e-uuid", target: ALL }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, platform: "google", target: ALL }).success).toBe(false);
  });
  it("limita pergunta e histórico", () => {
    expect(askRequestSchema.safeParse({ ...base, question: "x".repeat(1001), target: ALL }).success).toBe(false);
    expect(askRequestSchema.safeParse({ ...base, question: "   ", target: ALL }).success).toBe(false);
    const history = Array.from({ length: 7 }, () => ({ role: "user" as const, content: "oi" }));
    expect(askRequestSchema.safeParse({ ...base, history, target: ALL }).success).toBe(false);
  });
  it("buildAskRequest envia identificadores (inclusive as contas do contexto geral) e só o histórico do mesmo contexto", () => {
    const scope = { organizationId: IDS.org, clientId: IDS.client, platform: "meta" as const };
    const { context } = resolveContext({ scope, kind: "entity", accountId: IDS.accA, level: "campaign", entityId: "100" }, scope, campaignsData());
    const mk = (id: string, key: string, status: "sent" | "error" = "sent") => ({ id, role: "user" as const, content: id, createdAt: "", contextKey: key, status });
    const request = buildAskRequest(context, " Pergunta ", [mk("a", context.key), mk("b", "outro|contexto"), mk("c", context.key, "error")], IDS.client);
    expect(request).toEqual({ requestId: IDS.client, clientId: IDS.client, platform: "meta", period, target: { level: "campaign", accountId: IDS.accA, entityId: "100" }, question: "Pergunta", history: [{ role: "user", content: "a" }] });
    expect(JSON.stringify(request)).not.toContain(IDS.org);
    expect(JSON.stringify(request)).not.toContain("Captação");
    const general = resolveContext(null, scope, campaignsData({ selectedAccountIds: [IDS.accB] })).context;
    expect(buildAskRequest(general, "x", [], IDS.client).target).toEqual({ level: "client", accountIds: [IDS.accB] });
  });
});

describe("autenticação e autorização no servidor", () => {
  const ask = (raw: unknown, over: Partial<AssistantDeps> = {}) => { const m = makeDeps(over); return handleAssistantRequest(raw, m.deps).then(result => ({ result, ...m })); };
  const entity = { ...base, target: { level: "campaign" as const, accountId: IDS.accA, entityId: "100" } };

  it("sem sessão ou sem organização, bloqueia antes de qualquer leitura", async () => {
    const a = await ask(entity, { getSession: async () => ({ ok: false, code: "unauthenticated" }) });
    expect(a.result).toMatchObject({ ok: false, code: "unauthenticated" });
    const b = await ask(entity, { getSession: async () => ({ ok: false, code: "no_workspace" }) });
    expect(b.result).toMatchObject({ ok: false, code: "forbidden" });
    expect(a.calls.loadData).not.toHaveBeenCalled();
  });
  it("sem permissão para a área de Campanhas, bloqueia", async () => {
    const { result, calls } = await ask(entity, { canOpenCampaigns: async () => false });
    expect(result).toMatchObject({ ok: false, code: "forbidden" });
    expect(calls.loadData).not.toHaveBeenCalled();
  });
  it("cliente de outra organização é tratado como inexistente e nada é lido", async () => {
    const { result, calls } = await ask({ ...entity, clientId: IDS.otherOrgClient });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(calls.loadData).not.toHaveBeenCalled();
    expect(calls.readGate).not.toHaveBeenCalled();
  });
  it("a organização vem da sessão, não da solicitação", async () => {
    const other: AssistantSession = { ...session, agency: { ...session.agency, id: IDS.otherOrg } };
    const { result } = await ask(entity, { getSession: async () => ({ ok: true, session: other }) });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
  });
  it("conta que não pertence ao cliente é bloqueada, sem vazar dados", async () => {
    const { result } = await ask({ ...base, target: { level: "account", accountId: IDS.accOther } });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(JSON.stringify(result)).not.toContain("Captação");
  });
  it("entidade de outra conta, de outro nível ou inexistente é bloqueada", async () => {
    for (const target of [{ level: "adset", accountId: IDS.accB, entityId: "200" }, { level: "ad", accountId: IDS.accA, entityId: "100" }, { level: "campaign", accountId: IDS.accA, entityId: "999" }]) {
      expect((await ask({ ...base, target })).result).toMatchObject({ ok: false, code: "not_found" });
    }
  });
  it("período inválido ou que o servidor trocaria por outro bloqueia (sem fallback)", async () => {
    const inverted = await ask({ ...entity, period: { dateFrom: "2026-10-18", dateTo: "2026-09-19" } });
    expect(inverted.result).toMatchObject({ ok: false, code: "invalid_period" });
    const future = await ask({ ...entity, period: { dateFrom: "2026-10-01", dateTo: "2026-12-01" } });
    expect(future.result).toMatchObject({ ok: false, code: "invalid_period" });
    expect(future.calls.loadData).not.toHaveBeenCalled();
    const swapped = await ask(entity, { loadData: async () => campaignsData({ dateFrom: "2026-09-10", dateTo: "2026-10-09" }) });
    expect(swapped.result).toMatchObject({ ok: false, code: "invalid_period" });
  });
  it("dados não confirmados ou sem conta bloqueiam com a explicação do servidor", async () => {
    const blocked = await ask(entity, { loadData: async () => campaignsData({ state: "blocked", message: "Coleta em andamento." }) });
    expect(blocked.result).toMatchObject({ ok: false, code: "data_unavailable", message: "Coleta em andamento." });
    expect((await ask(entity, { loadData: async () => campaignsData({ state: "no-accounts" }) })).result).toMatchObject({ ok: false, code: "data_unavailable" });
  });
  it("catálogo disponível com métricas ainda não confirmadas: o assistente não analisa, não reserva e não chama o modelo", async () => {
    const pending = await ask(entity, { loadData: async () => campaignsData({ metricsState: "pending", rows: campaignsData().rows.map(row => ({ ...row, values: {}, metricsPending: true })) }) });
    expect(pending.result).toMatchObject({ ok: false, code: "data_unavailable" });
    expect(pending.result.ok ? "" : pending.result.message).toContain("ainda estão sendo atualizadas");
    expect(pending.calls.reserveUsage).not.toHaveBeenCalled();
  });
});

describe("escopo de contas reconstruído pelo servidor", () => {
  const ask = (target: unknown) => { const m = makeDeps({ model: model("Resposta sobre {e1.spend}.") }); return handleAssistantRequest({ ...base, target }, m.deps).then(result => ({ result, ...m })); };

  it("duas seleções diferentes de contas do mesmo cliente são lidas e identificadas separadamente", async () => {
    const onlyA = await ask({ level: "client", accountIds: [IDS.accA] });
    const both = await ask(ALL);
    const onlyB = await ask({ level: "client", accountIds: [IDS.accB] });
    expect(onlyA.calls.loadData).toHaveBeenCalledWith(IDS.client, expect.objectContaining({ contas: IDS.accA }));
    expect(both.calls.loadData).toHaveBeenCalledWith(IDS.client, expect.objectContaining({ contas: [IDS.accA, IDS.accB].sort().join(",") }));
    const keys = [onlyA, both, onlyB].map(item => item.result.ok ? item.result.reply.contextKey : "");
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toContain(IDS.accA);
    expect(keys[0]).not.toContain(IDS.accB);
    expect(keys[1]).toContain(`${[IDS.accA, IDS.accB].sort().join(",")}|client`);
  });
  it("o modelo recebe os fatos só das contas pedidas", async () => {
    const generate = vi.fn(async (): Promise<ModelResult> => ({ ok: true, text: "ok", usage }));
    const m = makeDeps({ model: { configured: true, generate } });
    await handleAssistantRequest({ ...base, target: { level: "client", accountIds: [IDS.accA] } }, m.deps);
    const facts = JSON.parse((generate.mock.calls[0] as unknown as [{ factsText: string }])[0].factsText);
    expect(facts.scope.accounts).toEqual([{ name: "Conta A", currency: "BRL" }]);
    expect(facts.entities.every((entity: { accountId: string }) => entity.accountId === IDS.accA)).toBe(true);
  });
  it("conta fora do vínculo autorizado nunca entra: o pedido é bloqueado, mesmo misturada a contas válidas", async () => {
    const mixed = await ask({ level: "client", accountIds: [IDS.accA, IDS.accOther] });
    expect(mixed.result).toMatchObject({ ok: false, code: "not_found" });
    const onlyForeign = await ask({ level: "client", accountIds: [IDS.accOther] });
    expect(onlyForeign.result).toMatchObject({ ok: false, code: "not_found" });
    expect(mixed.calls.reserveUsage).not.toHaveBeenCalled();
  });
  it("se o servidor carregar um conjunto diferente do pedido, a solicitação é bloqueada", async () => {
    const m = makeDeps({ loadData: async () => campaignsData() });
    expect(await handleAssistantRequest({ ...base, target: { level: "client", accountIds: [IDS.accA] } }, m.deps)).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("reserva atômica, chamada e liquidação (somente consulta)", () => {
  const entity = { ...base, target: { level: "campaign" as const, accountId: IDS.accA, entityId: "100" } };
  const ask = (over: Partial<AssistantDeps> = {}, raw: unknown = entity) => { const m = makeDeps(over); return handleAssistantRequest(raw, m.deps).then(result => ({ result, ...m })); };
  const failing = (reason: "timeout" | "provider_error" | "rate_limited" | "not_configured" | "model_not_connected"): AssistantModel => ({ configured: true, generate: vi.fn(async (): Promise<ModelResult> => ({ ok: false, reason })) });

  it("indisponível por padrão: sem chave de operação, nada é carregado, reservado, enviado ou liquidado", async () => {
    const { result, calls } = await ask({ model: unavailableModel, readGate: vi.fn(async () => ({ ...allowed, enabledByOperator: false, featureRegistered: false, reservationsReady: false, modelConfigured: false })) });
    expect(result).toMatchObject({ ok: false, code: "assistant_unavailable" });
    for (const fn of [calls.loadData, calls.reserveUsage, calls.settleUsage, calls.acquireSlot]) expect(fn).not.toHaveBeenCalled();
    expect(CAMPAIGN_CHAT_FEATURE).toBe("campaign_chat");
  });
  it("sem a estrutura de reservas no banco o chat não funciona, mesmo com todo o resto liberado", async () => {
    const { result, calls } = await ask({ readGate: vi.fn(async () => ({ ...allowed, reservationsReady: false })) });
    expect(result).toMatchObject({ ok: false, code: "assistant_unavailable" });
    expect(calls.reserveUsage).not.toHaveBeenCalled();
  });
  it("a reserva é criada ANTES da chamada ao modelo, com o requestId, o contexto verificado e um valor conservador; depois liquida com o consumo real", async () => {
    const m = makeDeps({ model: model("A campanha investiu {e1.spend}.") });
    const request = { ...entity, requestId: "22222222-2222-4222-8222-222222222222" };
    const result = await handleAssistantRequest(request, m.deps);
    expect(result).toMatchObject({ ok: true, reply: { text: "A campanha investiu R$ 300,00." } });
    if (result.ok) expect(result.reply.contextKey).toBe([IDS.org, IDS.client, "meta", IDS.accA, "campaign", "100", "2026-09-19..2026-10-18"].join("|"));
    const [input] = m.calls.reserveUsage.mock.calls[0] as unknown as [{ requestId: string; contextKey: string; estimatedUsd: number; agencyId: string; clientId: string; userId: string }];
    expect(input).toMatchObject({ agencyId: IDS.org, clientId: IDS.client, userId: "user-1", requestId: request.requestId });
    expect(input.contextKey).toContain(IDS.accA);
    expect(input.estimatedUsd).toBeGreaterThan(0.009);
    expect(m.calls.reserveUsage.mock.invocationCallOrder[0]!).toBeLessThan((m.deps.model.generate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
    expect(m.calls.settleUsage).toHaveBeenCalledWith(expect.objectContaining({ usageId: "usage-1", agencyId: IDS.org, clientId: IDS.client, outcome: "completed", status: "ok", verifierPassed: true, usage }));
    expect(m.calls.release).toHaveBeenCalledTimes(1);
  });
  it("o modelo recebe fatos do servidor, a pergunta e o histórico, nunca dados de autorização do navegador", async () => {
    const generate = vi.fn(async (): Promise<ModelResult> => ({ ok: true, text: "ok", usage }));
    const m = makeDeps({ model: { configured: true, generate } });
    await handleAssistantRequest({ ...entity, history: [{ role: "user", content: "oi" }] }, m.deps);
    const turn = (generate.mock.calls[0] as unknown as [{ factsText: string; system: string; history: unknown[]; question: string }])[0];
    expect(turn.question).toBe(entity.question);
    expect(turn.history).toEqual([{ role: "user", content: "oi" }]);
    expect(turn.system).toContain("somente consultivo");
    expect(turn.system).toContain("MARCADOR");
    const facts = JSON.parse(turn.factsText);
    expect(facts.period).toEqual(period);
    expect(facts.scope).toMatchObject({ level: "campaign", client: "Colégio Exemplo" });
    expect(turn.factsText).not.toContain(IDS.org);
  });
  it("reserva recusada (orçamento, interruptor, plano, restrição): nenhuma chamada paga e nenhuma liquidação", async () => {
    for (const outcome of ["budget", "disabled", "plan", "restricted"] as const) {
      const generate = vi.fn(async (): Promise<ModelResult> => ({ ok: true, text: "ok", usage }));
      const m = makeDeps({ model: { configured: true, generate }, reserveUsage: vi.fn(async (): Promise<ReserveResult> => ({ ok: false, outcome })) });
      expect(await handleAssistantRequest(entity, m.deps)).toMatchObject({ ok: false, code: "assistant_unavailable" });
      expect(generate).not.toHaveBeenCalled();
      expect(m.calls.settleUsage).not.toHaveBeenCalled();
      expect(m.calls.release).toHaveBeenCalledTimes(1);
    }
  });
  it("solicitação já reservada, concluída ou de resultado desconhecido nunca provoca outra chamada paga", async () => {
    const expectations = { duplicate_in_flight: undefined, duplicate_completed: undefined, duplicate_unknown: true } as const;
    for (const [outcome, possibleCharge] of Object.entries(expectations)) {
      const generate = vi.fn(async (): Promise<ModelResult> => ({ ok: true, text: "ok", usage }));
      const m = makeDeps({ model: { configured: true, generate }, reserveUsage: vi.fn(async (): Promise<ReserveResult> => ({ ok: false, outcome: outcome as "duplicate_in_flight", usageId: "usage-0" })) });
      const result = await handleAssistantRequest(entity, m.deps);
      expect(result).toMatchObject({ ok: false, code: "duplicate_request" });
      if (possibleCharge) expect(result).toMatchObject({ possibleCharge: true });
      expect(generate).not.toHaveBeenCalled();
      expect(m.calls.settleUsage).not.toHaveBeenCalled();
    }
  });
  it("identificador reutilizado com outro contexto, solicitação inválida ou reserva indisponível: bloqueia sem chamada paga (falha segura)", async () => {
    for (const [outcome, code] of [["conflict", "invalid_request"], ["invalid", "invalid_request"], ["unavailable", "assistant_unavailable"]] as const) {
      const generate = vi.fn(async (): Promise<ModelResult> => ({ ok: true, text: "ok", usage }));
      const m = makeDeps({ model: { configured: true, generate }, reserveUsage: vi.fn(async (): Promise<ReserveResult> => ({ ok: false, outcome })) });
      expect(await handleAssistantRequest(entity, m.deps)).toMatchObject({ ok: false, code });
      expect(generate).not.toHaveBeenCalled();
    }
  });
  it("resposta com valor digitado ou número inventado é bloqueada INTEIRA e o consumo real é liquidado como rejeitado", async () => {
    const m = makeDeps({ model: model("A campanha investiu 98765 reais, ou {e1.spend}.") });
    const result = await handleAssistantRequest(entity, m.deps);
    expect(result).toMatchObject({ ok: false, code: "unverified_numbers", possibleCharge: true });
    expect(JSON.stringify(result)).not.toContain("98765");
    expect(m.calls.settleUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed", status: "rejected_numbers", verifierPassed: false, usage }));
  });
  it("resposta incompleta com consumo informado: liquida com o consumo real e sinaliza possível cobrança", async () => {
    const m = makeDeps({ model: { configured: true, generate: async () => ({ ok: false, reason: "incomplete", usage }) } });
    expect(await handleAssistantRequest(entity, m.deps)).toMatchObject({ ok: false, code: "model_error", possibleCharge: true });
    expect(m.calls.settleUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed", status: "error", usage }));
  });
  it("timeout ou erro do provedor SEM uso: a reserva é mantida como consumo desconhecido (nunca liberada, nunca custo zero)", async () => {
    for (const reason of ["timeout", "provider_error"] as const) {
      const m = makeDeps({ model: failing(reason) });
      expect(await handleAssistantRequest(entity, m.deps)).toMatchObject({ ok: false, code: "model_error", possibleCharge: true });
      expect(m.calls.settleUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: "unknown", usage: null }));
      expect(m.calls.settleUsage).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "released" }));
    }
  });
  it("exceção inesperada do adaptador também vira consumo desconhecido e libera o espaço da chamada", async () => {
    const m = makeDeps({ model: { configured: true, generate: async () => { throw new Error("boom"); } } });
    expect(await handleAssistantRequest(entity, m.deps)).toMatchObject({ ok: false, code: "model_error", possibleCharge: true });
    expect(m.calls.settleUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: "unknown" }));
    expect(m.calls.release).toHaveBeenCalledTimes(1);
  });
  it("recusa certa sem consumo (limite do provedor, modelo ausente): a reserva é liberada e não há aviso de cobrança", async () => {
    for (const reason of ["rate_limited", "not_configured", "model_not_connected"] as const) {
      const m = makeDeps({ model: failing(reason) });
      const result = await handleAssistantRequest(entity, m.deps);
      expect(result).toMatchObject({ ok: false, code: "model_error" });
      expect(result).not.toHaveProperty("possibleCharge");
      expect(m.calls.settleUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: "released", usage: null }));
    }
  });
  it("falha ao liquidar com resposta válida: a resposta é RETIDA, o erro é explícito e a reserva permanece no banco", async () => {
    const m = makeDeps({ model: model("Total {e1.spend}."), settleUsage: vi.fn(async () => false) });
    const result = await handleAssistantRequest(entity, m.deps);
    expect(result).toMatchObject({ ok: false, code: "accounting_failed", possibleCharge: true, message: expect.stringContaining("pode ter gerado custo") });
    expect(JSON.stringify(result)).not.toContain("300");
    expect(m.calls.release).toHaveBeenCalledTimes(1);
  });
  it("falha ao liquidar também é erro explícito com consumo informado ou resposta rejeitada; em liberação/desconhecido mantém o erro do modelo", async () => {
    const withUsage = makeDeps({ model: { configured: true, generate: async () => ({ ok: false, reason: "incomplete", usage }) }, settleUsage: vi.fn(async () => false) });
    expect(await handleAssistantRequest(entity, withUsage.deps)).toMatchObject({ ok: false, code: "accounting_failed", possibleCharge: true });
    const rejected = makeDeps({ model: model("Gastou 98765."), settleUsage: vi.fn(async () => false) });
    expect(await handleAssistantRequest(entity, rejected.deps)).toMatchObject({ ok: false, code: "accounting_failed" });
    const unknown = makeDeps({ model: failing("timeout"), settleUsage: vi.fn(async () => false) });
    expect(await handleAssistantRequest(entity, unknown.deps)).toMatchObject({ ok: false, code: "model_error", possibleCharge: true });
  });
  it("com a contabilização comprometida o portão bloqueia novas chamadas antes de qualquer leitura ou reserva", async () => {
    const m = makeDeps({ readGate: vi.fn(async () => ({ ...allowed, accountingHealthy: false })) });
    expect(await handleAssistantRequest(entity, m.deps)).toMatchObject({ ok: false, code: "assistant_unavailable" });
    for (const fn of [m.calls.loadData, m.calls.reserveUsage, m.calls.acquireSlot]) expect(fn).not.toHaveBeenCalled();
  });
  it("proteções complementares da instância: mesma solicitação repetida e cliques simultâneos não chegam à reserva", async () => {
    const seen = new Set<string>();
    const same = { ...entity, requestId: "11111111-1111-4111-8111-111111111111" };
    const m = makeDeps({ claimRequest: key => (seen.has(key) ? false : (seen.add(key), true)) });
    expect(await handleAssistantRequest(same, m.deps)).toMatchObject({ ok: true });
    expect(await handleAssistantRequest(same, m.deps)).toMatchObject({ ok: false, code: "duplicate_request" });
    expect(m.calls.reserveUsage).toHaveBeenCalledTimes(1);
    expect([...seen][0]).toBe(`${IDS.org}:user-1:${same.requestId}`);
    const busy = makeDeps({ acquireSlot: () => null });
    expect(await handleAssistantRequest(entity, busy.deps)).toMatchObject({ ok: false, code: "busy" });
    expect(busy.calls.reserveUsage).not.toHaveBeenCalled();
  });
  it("o espaço da chamada é liberado mesmo quando a solicitação falha depois de adquirido", async () => {
    const m = makeDeps({ loadData: async () => { throw new Error("boom"); } });
    await expect(handleAssistantRequest(entity, m.deps)).rejects.toThrow("boom");
    expect(m.calls.release).toHaveBeenCalledTimes(1);
    expect(m.calls.reserveUsage).not.toHaveBeenCalled();
  });
  it("a solicitação sem requestId é inválida", () => {
    const { requestId: _omit, ...withoutId } = { ...entity, requestId: "x" };
    void _omit;
    expect(askRequestSchema.safeParse(withoutId).success).toBe(false);
  });
});

describe("portão de uso de IA (categoria própria, plano, cota)", () => {
  const gate = (over: Partial<GateConfig> = {}) => evaluateChatGate({ ...allowed, ...over });
  it("bloqueia sem chave de operação, sem categoria no banco, com contabilização em falha, sem modelo e quando não dá para verificar", () => {
    expect(gate({ enabledByOperator: false })).toMatchObject({ allowed: false, reason: "not_enabled" });
    expect(gate({ featureRegistered: false })).toMatchObject({ allowed: false, reason: "feature_not_registered" });
    expect(gate({ reservationsReady: false })).toMatchObject({ allowed: false, reason: "reservation_unavailable" });
    expect(gate({ accountingHealthy: false })).toMatchObject({ allowed: false, reason: "accounting" });
    expect(gate({ modelConfigured: false })).toMatchObject({ allowed: false, reason: "model_unavailable" });
    for (const over of [{ commercial: null }, { monthCostUsd: null }, { agencyEnabled: null }, { clientEnabled: null }]) expect(gate(over)).toMatchObject({ allowed: false, reason: "unverifiable" });
  });
  it("respeita plano, restrição, interruptores e cota mensal com folga de uma chamada", () => {
    expect(gate({ commercial: { allowed: false, budgetUsd: null, restricted: false } })).toMatchObject({ reason: "plan" });
    expect(gate({ commercial: { allowed: false, budgetUsd: null, restricted: true } })).toMatchObject({ reason: "restricted" });
    expect(gate({ agencyEnabled: false })).toMatchObject({ reason: "disabled" });
    expect(gate({ clientEnabled: false })).toMatchObject({ reason: "disabled" });
    expect(gate({ monthCostUsd: 5 })).toMatchObject({ allowed: false, reason: "budget" });
    expect(gate({ monthCostUsd: 4.96 })).toMatchObject({ allowed: false, reason: "budget" });
    expect(gate({ monthCostUsd: 4.9 })).toEqual({ allowed: true });
    expect(gate({ monthCostUsd: 4.5, estimatedCallCostUsd: 0.6 })).toMatchObject({ allowed: false, reason: "budget" });
    expect(gate({ commercial: { allowed: true, budgetUsd: 2, restricted: false }, agencyBudgetUsd: 50, monthCostUsd: 1.99 })).toMatchObject({ reason: "budget" });
  });
  it("readGateConfig lê a configuração da organização verificada e nega em caso de falha", async () => {
    const runtime = { enabledByOperator: true, featureRegistered: true, reservationsReady: true, accountingHealthy: true, modelConfigured: true, estimatedCallCostUsd: 0.05 };
    const supabase = (fail: boolean) => ({
      from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "ai_settings" ? { enabled: true, monthly_budget_usd: 8 } : { enabled: true }, error: fail ? { code: "x" } : null }) }) }) }),
      rpc: async (name: string) => name === "ai_month_cost" ? { data: 1.5, error: null } : { data: { allowed: true, budget_usd: 10, restricted: false }, error: null },
    }) as never;
    expect(await readGateConfig(supabase(false), IDS.org, IDS.client, runtime)).toMatchObject({ agencyEnabled: true, agencyBudgetUsd: 8, monthCostUsd: 1.5, commercial: { allowed: true, budgetUsd: 10 } });
    expect(evaluateChatGate(await readGateConfig(supabase(true), IDS.org, IDS.client, runtime))).toMatchObject({ reason: "unverifiable" });
  });
});
