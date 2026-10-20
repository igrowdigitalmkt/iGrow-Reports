import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/agent-executor/manual-actions", () => ({ requestManualMetaChange: vi.fn() }));
vi.mock("@/modules/agent-executor/scheduler", () => ({ agentSchedulerEnabled: () => true }));
vi.mock("@/modules/meta/server", () => ({ loadAccessToken: vi.fn(async () => "SEGREDO-TOKEN") }));
vi.mock("@/lib/env", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/env")>()), getMetaApiConfig: () => ({ apiVersion: "v25.0" }) }));

import { defaultReadEntity, loadManualHistory, resolveManualControl, runManualOperation, type ControlDeps, type RawEntity } from "@/modules/campaigns/manual/control";
import { probeWritePermission } from "@/modules/campaigns/manual/permissions";
import { currencyExponent, formatMinor, metaAccountStatusLabel, parseBudgetInput, validateBudgetChange, type ManualRef } from "@/modules/campaigns/manual/contracts";

const AGENCY = "00000000-0000-4000-8000-0000000000a1";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const ACCOUNT = "00000000-0000-4000-8000-0000000000b1";
const REQUEST = "00000000-0000-4000-8000-0000000000d1";
const owner = { agencyId: AGENCY, userId: "u1", role: "owner" };
const ref: ManualRef = { clientId: CLIENT, accountId: ACCOUNT, level: "campaign", entityId: "900" };
const adsetRef: ManualRef = { ...ref, level: "adset", entityId: "910" };

type Tables = Record<string, unknown>;
function fakeService(over: Tables = {}, rpc: { allowed?: boolean } = {}) {
  const tables: Tables = {
    clients: { id: CLIENT },
    client_ad_accounts: { active: true },
    meta_ad_accounts: { id: ACCOUNT, external_id: "act_1", name: "Conta 1", currency: "BRL", account_status: "1", meta_connection_id: "mc" },
    meta_connections: { id: "mc", integration_id: "in", scopes: ["ads_management", "ads_read"], connected_at: "2026-10-01T00:00:00Z" },
    integrations: { id: "in", connection_status: "connected", health_status: "ok" },
    agent_action_jobs: [],
    ...over,
  };
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const chain = (table: string) => {
    const value = tables[table];
    const c: Record<string, unknown> = {};
    for (const m of ["select", "is", "in", "order", "limit"]) c[m] = () => c;
    c.eq = (column: string, v: unknown) => { filters.push({ table, column, value: v }); return c; };
    c.maybeSingle = () => Promise.resolve({ data: Array.isArray(value) ? value[0] ?? null : value ?? null, error: null });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: Array.isArray(value) ? value : value ? [value] : [], error: null });
    return c;
  };
  return { filters, service: { from: (t: string) => chain(t), rpc: async () => ({ data: rpc.allowed ?? true, error: null }) } as never };
}

const campaign = (over: Partial<RawEntity> = {}): RawEntity => ({ id: "900", account_id: "1", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "10000", objective: "OUTCOME_LEADS", ...over });
const adset = (over: Partial<RawEntity> = {}): RawEntity => ({ id: "910", account_id: "act_1", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "5000", campaign_id: "900", ...over });
function deps(over: Partial<ControlDeps> & { entity?: RawEntity | null | "throw"; tables?: Tables; allowed?: boolean } = {}) {
  const { service } = fakeService(over.tables, { allowed: over.allowed });
  const readEntity = vi.fn(async () => { if (over.entity === "throw") throw new Error("meta down"); return over.entity === undefined ? campaign() : over.entity; });
  const request = vi.fn(async () => ({ ok: true as const, jobId: "j1", execution: "verified" }));
  const probeWrite = vi.fn<NonNullable<ControlDeps["probeWrite"]>>(async () => ({ state: "valid" }));
  return { service, readEntity, request, probeWrite, executorEnabled: () => true, ...over, entity: undefined, tables: undefined, allowed: undefined } as unknown as ControlDeps & { readEntity: typeof readEntity; request: ReturnType<typeof vi.fn>; probeWrite: ReturnType<typeof vi.fn<NonNullable<ControlDeps["probeWrite"]>>> };
}
const expected = { configuredStatus: "ACTIVE" as const, dailyBudgetMinor: 10000 as number | null };

describe("estado e permissões do controle manual", () => {
  it("papel sem permissão de escrita não lê a Meta nem oferece ação", async () => {
    for (const role of ["member", "viewer", "client"]) {
      const d = deps();
      expect(await resolveManualControl({ ...owner, role }, ref, d)).toMatchObject({ kind: "unauthorized" });
      expect(d.readEntity).not.toHaveBeenCalled();
    }
  });
  it("proprietário e administrador recebem o estado confirmado ao vivo, com moeda e orçamento", async () => {
    for (const role of ["owner", "admin"]) {
      const control = await resolveManualControl({ ...owner, role }, ref, deps());
      expect(control).toMatchObject({ kind: "ready", configuredStatus: "ACTIVE", dailyBudgetMinor: 10000, currency: "BRL", exponent: 2, busy: false,
        ops: { pause: { enabled: true }, resume: { enabled: false }, budget: { enabled: true } } });
    }
  });
  it("cliente de outra organização, vínculo inativo e conta não pertencente são tratados como incompatíveis, sem leitura na Meta", async () => {
    for (const tables of [{ clients: null }, { client_ad_accounts: { active: false } }, { client_ad_accounts: null }, { meta_ad_accounts: null }]) {
      const d = deps({ tables });
      expect(await resolveManualControl(owner, ref, d)).toMatchObject({ kind: "incompatible" });
      expect(d.readEntity).not.toHaveBeenCalled();
    }
  });
  it("identificadores malformados nunca chegam ao banco ou à Meta", async () => {
    const d = deps();
    for (const bad of [{ ...ref, clientId: "x" }, { ...ref, accountId: "../" }, { ...ref, entityId: "0" }, { ...ref, entityId: "12a" }, { ...ref, level: "ad" as never }]) {
      expect(await resolveManualControl(owner, bad, d)).toMatchObject({ kind: "incompatible" });
    }
    expect(d.readEntity).not.toHaveBeenCalled();
  });
  it("entidade de outra conta da Meta ou do tipo errado é incompatível", async () => {
    expect(await resolveManualControl(owner, ref, deps({ entity: campaign({ account_id: "999" }) }))).toMatchObject({ kind: "incompatible" });
    expect(await resolveManualControl(owner, ref, deps({ entity: campaign({ id: "901" }) }))).toMatchObject({ kind: "incompatible" });
    // Um conjunto (tem campaign_id, sem objective) usado como campanha, e o inverso.
    expect(await resolveManualControl(owner, ref, deps({ entity: adset({ id: "900" }) }))).toMatchObject({ kind: "incompatible" });
    expect(await resolveManualControl(owner, adsetRef, deps({ entity: campaign({ id: "910" }) }))).toMatchObject({ kind: "incompatible" });
    expect(await resolveManualControl(owner, ref, deps({ entity: null }))).toMatchObject({ kind: "incompatible" });
  });
  it("executor desligado (ambiente ou direito comercial) não consulta a Meta", async () => {
    const env = deps({ executorEnabled: () => false });
    expect(await resolveManualControl(owner, ref, env)).toMatchObject({ kind: "executor_disabled" });
    const gate = deps({ allowed: false });
    expect(await resolveManualControl(owner, ref, gate)).toMatchObject({ kind: "executor_disabled" });
    expect(env.readEntity).not.toHaveBeenCalled();
    expect(gate.readEntity).not.toHaveBeenCalled();
  });
  it("causas distintas: conexão offline, conta restrita na Meta e permissão de gerenciamento ausente", async () => {
    const disconnected: Tables[] = [{ meta_connections: null }, { integrations: { id: "in", connection_status: "disconnected", health_status: "ok" } }, { integrations: { id: "in", connection_status: "connected", health_status: "error" } }];
    for (const tables of disconnected) {
      const d = deps({ tables });
      expect(await resolveManualControl(owner, ref, d)).toMatchObject({ kind: "account_disconnected" });
      expect(d.readEntity).not.toHaveBeenCalled();
    }
    for (const account_status of ["2", "3", "7", "9", "101", ""]) {
      const d = deps({ tables: { meta_ad_accounts: { id: ACCOUNT, external_id: "act_1", name: "C", currency: "BRL", account_status, meta_connection_id: "mc" } } });
      const control = await resolveManualControl(owner, ref, d);
      expect(control).toMatchObject({ kind: "account_restricted" });
      expect("message" in control && control.message).toMatch(/leitura de dados continua/);
      expect(d.readEntity).not.toHaveBeenCalled();
    }
    const noScope = deps({ tables: { meta_connections: { id: "mc", integration_id: "in", scopes: ["ads_read"], connected_at: "2026-10-01T00:00:00Z" } } });
    expect(await resolveManualControl(owner, ref, noScope)).toMatchObject({ kind: "write_permission_missing", reason: "not_granted" });
    expect(noScope.readEntity).not.toHaveBeenCalled();
    expect(noScope.probeWrite).not.toHaveBeenCalled();
  });
  it("a permissão guardada não basta: a leitura ao vivo precisa confirmá-la (revogada, expirada, token inválido, não confirmada)", async () => {
    for (const reason of ["not_granted", "declined", "expired", "token_invalid", "unverified"] as const) {
      const d = deps();
      d.probeWrite.mockResolvedValueOnce({ state: "invalid", reason });
      expect(await resolveManualControl(owner, ref, d)).toMatchObject({ kind: "write_permission_missing", reason });
      const run = deps();
      run.probeWrite.mockResolvedValueOnce({ state: "invalid", reason });
      expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, run)).toMatchObject({ ok: false, code: "write_permission_missing" });
      expect(run.request).not.toHaveBeenCalled();
    }
    const boom = deps();
    boom.probeWrite.mockRejectedValueOnce(new Error("rede"));
    expect(await resolveManualControl(owner, ref, boom)).toMatchObject({ kind: "write_permission_missing", reason: "unverified" });
  });
  it("estado atual desconhecido (falha da Meta) não oferece ação; status arquivado não é operável", async () => {
    expect(await resolveManualControl(owner, ref, deps({ entity: "throw" }))).toMatchObject({ kind: "unknown_state" });
    for (const status of ["ARCHIVED", "DELETED", "WITH_ISSUES", "IN_PROCESS", ""]) {
      expect(await resolveManualControl(owner, ref, deps({ entity: campaign({ status }) }))).toMatchObject({ kind: "unsupported_status" });
    }
  });
  it("operação em andamento na conta desabilita todas as ações", async () => {
    const control = await resolveManualControl(owner, ref, deps({ tables: { agent_action_jobs: [{ id: "j0" }] } }));
    expect(control).toMatchObject({ kind: "ready", busy: true });
    if (control.kind === "ready") for (const op of Object.values(control.ops)) expect(op.enabled).toBe(false);
  });
  it("orçamento ausente, compartilhado ou vitalício nunca vira controle de orçamento (nem deriva do gasto)", async () => {
    for (const entity of [campaign({ daily_budget: undefined }), campaign({ daily_budget: "0", lifetime_budget: "500000" }), campaign({ daily_budget: "abc" })]) {
      const control = await resolveManualControl(owner, ref, deps({ entity }));
      expect(control).toMatchObject({ kind: "ready", dailyBudgetMinor: null, ops: { budget: { enabled: false } } });
    }
  });
  it("retomar exige orçamento diário confirmado no nível (regra do executor)", async () => {
    const paused = await resolveManualControl(owner, adsetRef, deps({ entity: adset({ status: "PAUSED", daily_budget: undefined }) }));
    expect(paused).toMatchObject({ kind: "ready", ops: { resume: { enabled: false }, pause: { enabled: false } } });
    const ok = await resolveManualControl(owner, adsetRef, deps({ entity: adset({ status: "PAUSED" }) }));
    expect(ok).toMatchObject({ kind: "ready", ops: { resume: { enabled: true }, budget: { enabled: false } } });
  });
  it("moeda sem casas decimais e fora do padrão", async () => {
    const jpy = await resolveManualControl(owner, ref, deps({ tables: { meta_ad_accounts: { id: ACCOUNT, external_id: "act_1", name: "C", currency: "JPY", account_status: "1", meta_connection_id: "mc" } } }));
    expect(jpy).toMatchObject({ kind: "ready", currency: "JPY", exponent: 0 });
  });
});

describe("execução manual pelo executor existente", () => {
  it("pausar: revalida no servidor, usa o executor e devolve o estado atualizado", async () => {
    const d = deps();
    const result = await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, d);
    expect(result).toMatchObject({ ok: true, outcome: "verified", control: { kind: "ready" } });
    expect(d.request).toHaveBeenCalledTimes(1);
    expect(d.request.mock.calls[0]![0]).toMatchObject({ action: "pause_campaign", targetId: "900", clientId: CLIENT, adAccountId: ACCOUNT, requestId: REQUEST });
    expect(d.request.mock.calls[0]![0]).not.toHaveProperty("dailyBudgetMinor");
    expect(d.readEntity).toHaveBeenCalledTimes(2); // antes (revalidação) e depois (estado atualizado)
  });
  it("conjunto usa as ações de conjunto", async () => {
    const d = deps({ entity: adset() });
    await runManualOperation(owner, { ref: adsetRef, op: "pause", requestId: REQUEST, expected }, d);
    expect(d.request.mock.calls[0]![0]).toMatchObject({ action: "pause_adset", targetId: "910" });
  });
  it("usuário sem permissão, conta errada, executor desligado e estado desconhecido nunca chamam o executor", async () => {
    for (const [actor, d, code] of [
      [{ ...owner, role: "member" }, deps(), "unauthorized"],
      [owner, deps({ tables: { client_ad_accounts: null } }), "incompatible"],
      [owner, deps({ executorEnabled: () => false }), "executor_disabled"],
      [owner, deps({ entity: "throw" }), "unknown_state"],
      [owner, deps({ entity: campaign({ account_id: "2" }) }), "incompatible"],
    ] as const) {
      expect(await runManualOperation(actor, { ref, op: "pause", requestId: REQUEST, expected }, d)).toMatchObject({ ok: false, code });
      expect(d.request).not.toHaveBeenCalled();
    }
  });
  it("estado antigo na tela (a Meta mudou) é recusado sem enviar nada", async () => {
    const d = deps({ entity: campaign({ status: "PAUSED" }) });
    expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, d)).toMatchObject({ ok: false, code: "unavailable" });
    const stale = deps({ entity: campaign({ daily_budget: "20000" }) });
    expect(await runManualOperation(owner, { ref, op: "budget", requestId: REQUEST, expected, dailyBudgetMinor: 12000 }, stale)).toMatchObject({ ok: false, code: "stale" });
    const resumed = deps({ entity: campaign({ status: "PAUSED" }) });
    expect(await runManualOperation(owner, { ref, op: "resume", requestId: REQUEST, expected }, resumed)).toMatchObject({ ok: false, code: "stale" });
    for (const x of [d, stale, resumed]) expect(x.request).not.toHaveBeenCalled();
  });
  it("conta ocupada impede nova operação; solicitação duplicada vira 'duplicate'", async () => {
    const busy = deps({ tables: { agent_action_jobs: [{ id: "j0" }] } });
    expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, busy)).toMatchObject({ ok: false, code: "busy" });
    expect(busy.request).not.toHaveBeenCalled();
    const dup = deps();
    dup.request.mockResolvedValueOnce({ ok: false, message: "ja", code: "duplicate" });
    expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, dup)).toMatchObject({ ok: false, code: "duplicate" });
  });
  it("falha antes do POST (bloqueio de segurança) e resultado desconhecido depois do POST", async () => {
    const blocked = deps();
    blocked.request.mockResolvedValueOnce({ ok: true, jobId: "j", execution: "failed" });
    expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, blocked)).toMatchObject({ ok: false, code: "blocked" });
    const uncertain = deps();
    uncertain.request.mockResolvedValueOnce({ ok: true, jobId: "j", execution: "needs_verification" });
    const result = await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, uncertain);
    expect(result).toMatchObject({ ok: true, outcome: "needs_verification" });
    expect(result.ok && result.message).toMatch(/ainda não confirmou/);
    const down = deps();
    down.request.mockResolvedValueOnce({ ok: true, jobId: "j", execution: "unavailable" });
    expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, down)).toMatchObject({ ok: false, code: "unavailable" });
    const closed = deps();
    closed.request.mockResolvedValueOnce({ ok: false, message: "x", code: "executor_disabled" });
    expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected }, closed)).toMatchObject({ ok: false, code: "executor_disabled" });
  });
  it("orçamento: só com valor válido, confirmado e dentro do limite; o executor recebe a unidade mínima", async () => {
    const d = deps();
    expect(await runManualOperation(owner, { ref, op: "budget", requestId: REQUEST, expected, dailyBudgetMinor: 12000 }, d)).toMatchObject({ ok: true });
    expect(d.request.mock.calls[0]![0]).toMatchObject({ action: "set_campaign_daily_budget", dailyBudgetMinor: 12000 });
    for (const dailyBudgetMinor of [undefined, 10000, 110001]) {
      const x = deps();
      expect(await runManualOperation(owner, { ref, op: "budget", requestId: REQUEST, expected, ...(dailyBudgetMinor ? { dailyBudgetMinor } : {}) }, x)).toMatchObject({ ok: false, code: "invalid" });
      expect(x.request).not.toHaveBeenCalled();
    }
    // Pausa/retomada não aceitam valor financeiro embutido.
    const smuggled = deps();
    expect(await runManualOperation(owner, { ref, op: "pause", requestId: REQUEST, expected, dailyBudgetMinor: 1 }, smuggled)).toMatchObject({ ok: false, code: "invalid" });
    expect(smuggled.request).not.toHaveBeenCalled();
    // Orçamento desconhecido: nada a alterar.
    const unknown = deps({ entity: campaign({ daily_budget: undefined }) });
    expect(await runManualOperation(owner, { ref, op: "budget", requestId: REQUEST, expected: { ...expected, dailyBudgetMinor: null }, dailyBudgetMinor: 5000 }, unknown)).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("histórico do ledger", () => {
  it("devolve só campos seguros, com origem, aprovação e confirmação", async () => {
    const job = { id: "j1", created_at: "2026-10-20T10:00:00Z", action_type: "pause_campaign", execution_origin: "manual", requested_by: "u1", approved_by: null, status: "verified", failure_code: null,
      before_state: { previous_status: "ACTIVE", previous_daily_budget_minor: 10000, segredo: "x" }, after_state: { confirmed_status: "PAUSED" }, daily_budget_minor: null, rationale: "texto interno", idempotency_key: "k" };
    const ai = { ...job, id: "j2", execution_origin: "ai", requested_by: null, approved_by: "u9", action_type: "set_campaign_daily_budget", daily_budget_minor: 12000, after_state: { confirmed_daily_budget_minor: 12000 } };
    const history = await loadManualHistory(owner, ref, deps({ tables: { agent_action_jobs: [job, ai] } }));
    expect(history).toHaveLength(2);
    expect(history![0]).toMatchObject({ origin: "manual", requestedBy: "you", approved: null, status: "verified", previousStatus: "ACTIVE", confirmedStatus: "PAUSED", previousBudgetMinor: 10000 });
    expect(history![1]).toMatchObject({ origin: "ai", requestedBy: "ai", approved: true, requestedBudgetMinor: 12000, confirmedBudgetMinor: 12000 });
    expect(JSON.stringify(history)).not.toMatch(/segredo|texto interno|idempotency|"k"/);
  });
  it("sem permissão ou fora do escopo não devolve histórico", async () => {
    expect(await loadManualHistory({ ...owner, role: "member" }, ref, deps())).toBeNull();
    expect(await loadManualHistory(owner, ref, deps({ tables: { client_ad_accounts: null } }))).toBeNull();
  });
  it("a consulta é sempre filtrada pela organização, cliente e entidade", async () => {
    const fake = fakeService();
    await loadManualHistory(owner, ref, { service: fake.service, executorEnabled: () => true } as never);
    const jobs = fake.filters.filter(f => f.table === "agent_action_jobs").map(f => `${f.column}=${String(f.value)}`);
    expect(jobs).toEqual(expect.arrayContaining([`agency_id=${AGENCY}`, `client_id=${CLIENT}`, `ad_account_id=${ACCOUNT}`, "meta_entity_id=900"]));
  });
});

describe("valores financeiros", () => {
  it("interpreta o formato brasileiro sem ponto flutuante e respeita as casas da moeda", () => {
    expect(parseBudgetInput("150", 2)).toEqual({ ok: true, minor: 15000 });
    expect(parseBudgetInput("1.234,56", 2)).toEqual({ ok: true, minor: 123456 });
    expect(parseBudgetInput("R$ 50,5", 2)).toEqual({ ok: true, minor: 5050 });
    expect(parseBudgetInput("0,29", 2)).toEqual({ ok: true, minor: 29 });
    expect(parseBudgetInput("500", 0)).toEqual({ ok: true, minor: 500 });
    for (const bad of ["", "abc", "10,999", "-5", "0", "0,00", "1,2,3", "1e3", "10.5.0"]) expect(parseBudgetInput(bad, 2).ok).toBe(false);
    expect(parseBudgetInput("10,5", 0).ok).toBe(false);
    expect(parseBudgetInput("99999999999999999", 2).ok).toBe(false);
  });
  it("moedas e formatação", () => {
    expect(currencyExponent("BRL")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("brl")).toBeNull();
    expect(currencyExponent("")).toBeNull();
    expect(formatMinor(15000, "BRL", 2)).toContain("150,00");
  });
  it("limites: sem alteração, aumento acima de 1000% e valor atual desconhecido", () => {
    expect(validateBudgetChange(10000, 10000).ok).toBe(false);
    expect(validateBudgetChange(10000, 110001).ok).toBe(false);
    expect(validateBudgetChange(10000, 110000).ok).toBe(true); // aumento de exatamente 1000% = 11x o atual
    expect(validateBudgetChange(10000, 100000).ok).toBe(true);
    expect(validateBudgetChange(10000, 10001).ok).toBe(true);
    expect(validateBudgetChange(10000, 0).ok).toBe(false);
    expect(validateBudgetChange(10000, -5).ok).toBe(false);
    expect(validateBudgetChange(10000, 5000.5).ok).toBe(false);
    expect(validateBudgetChange(10000, 1).ok).toBe(true);
    expect(validateBudgetChange(null, 5000).ok).toBe(false);
  });
});

describe("paridade da validação de orçamento com a política do executor", () => {
  it("interface e executor decidem igual em toda a fronteira (inclusive valores altos)", async () => {
    const { evaluateDelegatedAction } = await import("@/modules/agent-executor/policy");
    const now = new Date("2026-10-20T12:00:00Z");
    const decide = (current: number, next: number) => evaluateDelegatedAction({
      now,
      proposal: { actionId: REQUEST, action: "set_campaign_daily_budget", targetId: "900", adAccountId: "act_1", dailyBudgetMinor: next, factsCollectedAt: now.toISOString(), rationale: "Alteracao manual teste" },
      delegation: { agencyId: AGENCY, clientId: CLIENT, adAccountId: "act_1", enabled: true, revokedAt: null, expiresAt: new Date(now.getTime() + 300000).toISOString(), allowedActions: ["set_campaign_daily_budget"],
        maxAccountDailyBudgetMinor: 1e12, maxEntityDailyBudgetMinor: 1e12, maxIncreaseMinorPerAction: 1e12, maxIncreasePercentPerAction: 1000 },
      context: { agencyId: AGENCY, clientId: CLIENT, adAccountId: "act_1", currency: "BRL", hasWritePermission: true, userMayDelegate: true, commercialAccessActive: true, metaConnectionActive: true, confirmedActiveDailyBudgetMinor: current, budgetCoverageComplete: true },
      entity: { id: "900", adAccountId: "act_1", level: "campaign", configuredStatus: "ACTIVE", dailyBudgetMinor: current, fetchedAt: now.toISOString() },
    });
    for (const current of [1, 3, 100, 10000, 123457, 99_999_999_999]) {
      const limit = current + Math.floor(current * 1000 / 100);
      for (const next of [1, Math.max(1, current - 1), current + 1, limit - 1, limit, limit + 1, limit + 1000].filter(value => value >= 1 && value <= 1e12 && value !== current)) {
        const ui = validateBudgetChange(current, next).ok;
        const executor = decide(current, next).ok;
        expect({ current, next, ui }).toEqual({ current, next, ui: executor });
      }
    }
  });
});

describe("leitura ao vivo da permissão de gerenciamento", () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body })) as unknown as typeof fetch;
  const perms = (...items: Array<[string, string]>) => ({ data: items.map(([permission, status]) => ({ permission, status })) });
  it("válida somente quando ads_management está granted", async () => {
    expect(await probeWritePermission("tok", "v25.0", reply(200, perms(["ads_read", "granted"], ["ads_management", "granted"])))).toEqual({ state: "valid" });
  });
  it("distingue ausente, recusada e expirada", async () => {
    expect(await probeWritePermission("tok", "v25.0", reply(200, perms(["ads_read", "granted"])))).toEqual({ state: "invalid", reason: "not_granted" });
    expect(await probeWritePermission("tok", "v25.0", reply(200, perms(["ads_management", "declined"])))).toEqual({ state: "invalid", reason: "declined" });
    expect(await probeWritePermission("tok", "v25.0", reply(200, perms(["ads_management", "expired"])))).toEqual({ state: "invalid", reason: "expired" });
  });
  it("token revogado (190) vira token_invalid; outras falhas e respostas inválidas ficam não confirmadas", async () => {
    expect(await probeWritePermission("tok", "v25.0", reply(400, { error: { code: 190 } }))).toEqual({ state: "invalid", reason: "token_invalid" });
    expect(await probeWritePermission("tok", "v25.0", reply(500, { error: { code: 2 } }))).toEqual({ state: "invalid", reason: "unverified" });
    expect(await probeWritePermission("tok", "v25.0", reply(200, { lixo: true }))).toEqual({ state: "invalid", reason: "unverified" });
    expect(await probeWritePermission("tok", "v25.0", reply(200, null))).toEqual({ state: "invalid", reason: "unverified" });
    expect(await probeWritePermission("tok", "v25.0", vi.fn(async () => { throw new Error("rede"); }) as unknown as typeof fetch)).toEqual({ state: "invalid", reason: "unverified" });
    expect(await probeWritePermission("", "v25.0", reply(200, perms(["ads_management", "granted"])))).toEqual({ state: "invalid", reason: "unverified" });
    expect(await probeWritePermission("tok", "x", reply(200, perms(["ads_management", "granted"])))).toEqual({ state: "invalid", reason: "unverified" });
  });
  it("faz só GET e nunca devolve o token", async () => {
    const fetchImpl = reply(200, perms(["ads_management", "granted"]));
    const result = await probeWritePermission("SEGREDO-TOKEN", "v25.0", fetchImpl);
    const call = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(call[1].method).toBe("GET");
    expect(JSON.stringify(result)).not.toContain("SEGREDO");
    expect(call[0]).not.toContain("SEGREDO");
  });
  it("rótulos de status da conta", () => {
    expect(metaAccountStatusLabel("1")).toBe("ativa");
    expect(metaAccountStatusLabel("3")).toMatch(/pagamento/);
    expect(metaAccountStatusLabel(null)).toMatch(/sem status/);
  });
});

describe("leitura direta da entidade (mesmo GET do executor)", () => {
  const scope = { agencyId: AGENCY, integrationId: "in", connectionId: "mc" };
  const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 300, status, json: async () => body })) as unknown as typeof fetch;
  it("faz GET em /{id} com Bearer, sem token na URL, e devolve a entidade", async () => {
    const fetchImpl = reply(200, campaign());
    const entity = await defaultReadEntity({} as never, scope, "900", "campaign", fetchImpl);
    expect(entity).toMatchObject({ id: "900", status: "ACTIVE" });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v25\.0\/900\?fields=/);
    expect(url).not.toContain("SEGREDO");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SEGREDO-TOKEN");
    expect(url).toContain("objective");
    await defaultReadEntity({} as never, scope, "910", "adset", fetchImpl);
    expect((fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[1]![0]).toContain("campaign_id");
  });
  it("erro da Meta lança e só registra um código curto (sem token, URL ou mensagem)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(defaultReadEntity({} as never, scope, "900", "campaign", reply(400, { error: { code: 100, message: "token SEGREDO-TOKEN inválido" } }))).rejects.toThrow("entity_read_failed");
    expect(String(warn.mock.calls[0]?.[0])).toBe("manual_control entity read failed http 400 code 100");
    warn.mockRestore();
  });
  it("sem id na resposta a entidade é desconhecida (null)", async () => {
    expect(await defaultReadEntity({} as never, scope, "900", "campaign", reply(200, {}))).toBeNull();
  });
});
