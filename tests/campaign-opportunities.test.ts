import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/agent-executor/queue", () => ({ AgentQueueError: class extends Error {}, stageMetaDecision: vi.fn() }));
vi.mock("@/modules/meta/server", () => ({ loadAccessToken: vi.fn() }));

import { analyzeOpportunities, loadOpportunityState, opportunityAvailability, type OpportunityDeps } from "@/modules/campaigns/opportunities/service";
import { stageForJobStatus } from "@/modules/campaigns/opportunities/contracts";

const AGENCY = "00000000-0000-4000-8000-0000000000a1";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CLIENT = "00000000-0000-4000-8000-0000000000c2";
const ACCOUNT = "00000000-0000-4000-8000-0000000000b1";
const owner = { agencyId: AGENCY, userId: "u1", role: "owner" };
const NOW = new Date("2026-10-20T12:00:00Z");
const future = "2027-01-01T00:00:00Z";

type Tables = Record<string, unknown>;
function fakeService(over: Tables = {}) {
  const tables: Tables = {
    clients: { id: CLIENT },
    client_ad_accounts: [{ ad_account_id: ACCOUNT }],
    agent_delegations: [{ ad_account_id: ACCOUNT, enabled: true, revoked_at: null, expires_at: future }],
    agent_analysis_runs: [], agent_action_jobs: [],
    ...over,
  };
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const writes: string[] = [];
  const chain = (table: string) => {
    const value = tables[table];
    const c: Record<string, unknown> = {};
    for (const m of ["select", "is", "in", "order", "limit"]) c[m] = () => c;
    c.eq = (column: string, v: unknown) => { filters.push({ table, column, value: v }); return c; };
    for (const m of ["insert", "update", "upsert", "delete"]) c[m] = () => { writes.push(`${table}.${m}`); return c; };
    c.maybeSingle = () => Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value ?? null, error: null });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: Array.isArray(value) ? value : value ? [value] : [], error: null });
    return c;
  };
  return { filters, writes, service: { from: (t: string) => chain(t), rpc: async () => ({ data: null, error: null }) } as never };
}
function deps(over: Partial<OpportunityDeps> & { tables?: Tables } = {}) {
  const fake = fakeService(over.tables);
  const cycle = vi.fn(async () => ({ ok: true as const, accounts: [{ adAccountId: ACCOUNT, status: "done" as const, summary: "x", stages: [], observations: 1, rejected: 0, rejectedReasons: [], rejectedDetails: [] }] }));
  const model = vi.fn(() => ({ decide: vi.fn() }));
  const d = { service: fake.service, engineEnabled: () => true, aiConfigured: () => true, allowance: vi.fn(async () => "ok" as const), cycle, model, now: () => NOW, ...over, tables: undefined };
  return { deps: d as unknown as OpportunityDeps & { cycle: typeof cycle; model: typeof model; allowance: ReturnType<typeof vi.fn> }, fake };
}

describe("disponibilidade da análise operacional", () => {
  it("permitida: perfil, cliente, mecanismo, IA, conta e delegação válidos", async () => {
    expect(await opportunityAvailability(owner, CLIENT, deps().deps)).toEqual({ state: "available", accounts: 1 });
  });
  it("bloqueada para quem não é proprietário ou administrador, sem tocar o banco", async () => {
    for (const role of ["member", "viewer", "client"]) {
      const { deps: d, fake } = deps();
      expect(await opportunityAvailability({ ...owner, role }, CLIENT, d)).toMatchObject({ state: "unauthorized" });
      expect(fake.filters).toHaveLength(0);
    }
  });
  it("bloqueada por cliente inválido, arquivado ou de outra organização", async () => {
    expect(await opportunityAvailability(owner, "x", deps().deps)).toMatchObject({ state: "error" });
    expect(await opportunityAvailability(owner, CLIENT, deps({ tables: { clients: null } }).deps)).toMatchObject({ state: "error" });
  });
  it("bloqueada com o mecanismo desligado ou a IA sem chave", async () => {
    expect(await opportunityAvailability(owner, CLIENT, deps({ engineEnabled: () => false }).deps)).toMatchObject({ state: "engine_disabled" });
    expect(await opportunityAvailability(owner, CLIENT, deps({ aiConfigured: () => false }).deps)).toMatchObject({ state: "ai_unavailable" });
  });
  it("bloqueada sem conta vinculada ou sem delegação vigente (revogada, desligada, vencida ou de outra conta)", async () => {
    expect(await opportunityAvailability(owner, CLIENT, deps({ tables: { client_ad_accounts: [] } }).deps)).toMatchObject({ state: "no_accounts" });
    const bad = [
      [], [{ ad_account_id: ACCOUNT, enabled: false, revoked_at: null, expires_at: future }],
      [{ ad_account_id: ACCOUNT, enabled: true, revoked_at: "2026-10-01T00:00:00Z", expires_at: future }],
      [{ ad_account_id: ACCOUNT, enabled: true, revoked_at: null, expires_at: "2026-10-01T00:00:00Z" }],
      [{ ad_account_id: "00000000-0000-4000-8000-0000000000ff", enabled: true, revoked_at: null, expires_at: future }],
    ];
    for (const agent_delegations of bad) expect(await opportunityAvailability(owner, CLIENT, deps({ tables: { agent_delegations } }).deps)).toMatchObject({ state: "no_delegation" });
  });
  it("bloqueada por plano/configuração e por orçamento esgotado", async () => {
    expect(await opportunityAvailability(owner, CLIENT, deps({ allowance: vi.fn(async () => "unavailable" as const) }).deps)).toMatchObject({ state: "ai_unavailable" });
    expect(await opportunityAvailability(owner, CLIENT, deps({ allowance: vi.fn(async () => "budget" as const) }).deps)).toMatchObject({ state: "ai_budget" });
  });
});

describe("pedido de análise", () => {
  it.each([
    ["sem permissão", { ...owner, role: "member" }, {}, "unauthorized"],
    ["mecanismo desligado", owner, { engineEnabled: () => false }, "engine_disabled"],
    ["plano bloqueia", owner, { allowance: vi.fn(async () => "unavailable" as const) }, "ai_unavailable"],
    ["orçamento", owner, { allowance: vi.fn(async () => "budget" as const) }, "ai_budget"],
    ["sem delegação", owner, { tables: { agent_delegations: [] } }, "no_delegation"],
  ] as const)("%s: nenhum modelo é chamado e nada é gravado", async (_name, actor, over, code) => {
    const { deps: d, fake } = deps(over as Partial<OpportunityDeps>);
    expect(await analyzeOpportunities(actor, CLIENT, d)).toMatchObject({ ok: false, code });
    expect(d.cycle).not.toHaveBeenCalled();
    expect(d.model).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });
  it("válido: roda o ciclo existente para ESTE cliente, com origem manual, e nunca escreve no ledger por conta própria", async () => {
    const { deps: d, fake } = deps();
    const result = await analyzeOpportunities(owner, CLIENT, d);
    expect(result).toMatchObject({ ok: true, summary: { analyzedAccounts: 1, skipped: [] } });
    expect(d.cycle).toHaveBeenCalledTimes(1);
    const call = d.cycle.mock.calls[0] as unknown as [unknown, { agencyId: string; clientId: string }, { origin: string; requestedBy: string; enabled: boolean }];
    expect(call[1]).toEqual({ agencyId: AGENCY, clientId: CLIENT });
    expect(call[2]).toMatchObject({ origin: "manual", requestedBy: "u1", enabled: true });
    expect(fake.writes).toEqual([]); // aprovação, execução e fila pertencem ao ciclo/queue existentes; este serviço só lê
  });
  it("motivos de contas ignoradas viram mensagens e nada é inventado", async () => {
    const cycle = vi.fn(async () => ({ ok: true as const, accounts: [{ adAccountId: ACCOUNT, status: "skipped" as const, reason: "invalid_output" }, { adAccountId: "b", status: "skipped" as const, reason: "duplicate_request" }] }));
    const result = await analyzeOpportunities(owner, CLIENT, deps({ cycle }).deps);
    expect(result).toMatchObject({ ok: true, summary: { analyzedAccounts: 0 } });
    expect(result.ok && result.summary.skipped.map(item => item.reason)).toEqual(["invalid_output", "duplicate_request"]);
    expect(result.ok && result.summary.skipped.every(item => item.message.length > 10)).toBe(true);
  });
  it("falha do ciclo (cota, indisponibilidade, exceção) não promete nada e não vaza detalhes", async () => {
    const budget = await analyzeOpportunities(owner, CLIENT, deps({ cycle: vi.fn(async () => ({ ok: false as const, reason: "ai_budget" as const })) }).deps);
    expect(budget).toMatchObject({ ok: false, code: "ai_budget" });
    const boom = await analyzeOpportunities(owner, CLIENT, deps({ cycle: vi.fn(async () => { throw new Error("segredo-interno token=abc"); }) }).deps);
    expect(boom).toMatchObject({ ok: false, code: "error" });
    expect(JSON.stringify(boom)).not.toMatch(/segredo|token/);
  });
});

describe("estado, estágios e isolamento", () => {
  const job = (over: Record<string, unknown>) => ({ id: "j1", ad_account_id: ACCOUNT, action_type: "pause_campaign", meta_entity_id: "900", daily_budget_minor: null, status: "awaiting_approval",
    created_at: "2026-10-20T11:00:00Z", approval_expires_at: "2026-10-20T11:15:00Z", approved_by: null, failure_code: null, ...over });
  it("classifica os cinco estados sem nunca chamar de executada algo não confirmado", () => {
    expect(stageForJobStatus("awaiting_approval")).toBe("awaiting_approval");
    expect(stageForJobStatus("verified")).toBe("executed");
    for (const status of ["proposed", "authorized", "queued", "executing", "verifying", "needs_verification"]) expect(stageForJobStatus(status)).toBe("proposal");
    for (const status of ["rejected", "expired", "failed"]) expect(stageForJobStatus(status)).toBeNull();
  });
  it("proposta financeira aparece aguardando aprovação humana; vencida é marcada como expirada", async () => {
    const tables = { agent_action_jobs: [job({ approval_expires_at: "2026-10-20T13:00:00Z" }), job({ id: "j2", approval_expires_at: "2026-10-20T11:15:00Z" }), job({ id: "j3", action_type: "set_campaign_daily_budget", daily_budget_minor: 12000, status: "verified", approved_by: "u2" })],
      agent_analysis_runs: [{ id: "r1", created_at: "2026-10-20T11:00:00Z", origin: "manual", ad_account_id: ACCOUNT, summary: "Resumo validado.", observations: [{ name: "Campanha Z", level: "campaign", rationale: "Gasto alto sem resultado.", extra: "x" }, { lixo: true }], proposals: 1, blocked: 0, rejected: 0 }] };
    const state = await loadOpportunityState(owner, CLIENT, deps({ tables }).deps);
    expect(state.jobs.map(item => [item.id, item.expired, item.approved])).toEqual([["j1", false, false], ["j2", true, false], ["j3", false, true]]);
    expect(state.runs[0]!.observations).toEqual([{ name: "Campanha Z", level: "campaign", rationale: "Gasto alto sem resultado." }]);
    expect(state.scope.requiresApproval).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/rationale_interna|idempotency/);
  });
  it("quem não é proprietário/administrador não recebe análises nem propostas", async () => {
    const state = await loadOpportunityState({ ...owner, role: "member" }, CLIENT, deps({ tables: { agent_action_jobs: [job({})] } }).deps);
    expect(state.jobs).toEqual([]);
    expect(state.runs).toEqual([]);
  });
  it("todas as leituras são filtradas pela organização, pelo cliente e só por propostas da IA", async () => {
    const { deps: d, fake } = deps();
    await loadOpportunityState(owner, CLIENT, d);
    for (const table of ["agent_analysis_runs", "agent_action_jobs"]) {
      const f = fake.filters.filter(item => item.table === table).map(item => `${item.column}=${String(item.value)}`);
      expect(f).toEqual(expect.arrayContaining([`agency_id=${AGENCY}`, `client_id=${CLIENT}`]));
      expect(f).not.toContain(`client_id=${OTHER_CLIENT}`);
    }
    expect(fake.filters.filter(item => item.table === "agent_action_jobs").map(item => `${item.column}=${String(item.value)}`)).toContain("execution_origin=ai");
  });
});
