import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const stage = vi.hoisted(() => vi.fn());
vi.mock("@/modules/agent-executor/queue", () => {
  class AgentQueueError extends Error { constructor(readonly code: string) { super(code); } }
  return { AgentQueueError, stageMetaDecision: stage };
});
vi.mock("@/modules/meta/server", () => ({ loadAccessToken: vi.fn() }));

import { runDecisionCycle } from "@/modules/agent-executor/decision-cycle";
import { readLiveEntityState } from "@/modules/agent-executor/decision-live-state";

const NOW = new Date("2026-10-19T12:00:00Z");
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const hierarchy = [
  { key: "campaign:900", id: "900", level: "campaign", name: "Campanha Z", parentId: null, campaignId: null,
    accountId: ACCOUNT, accountName: "Conta", currency: "BRL", values: { spend: 800, conversions: 3 } },
];

type Table = { data?: unknown; error?: unknown };
function fakeService(tables: Record<string, Table>, rpcs: Record<string, Table>) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "single"]) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve({ data: tables[table]?.data ?? null, error: tables[table]?.error ?? null });
    c.insert = (row: Record<string, unknown>) => { inserts.push({ table, row }); return Promise.resolve({ error: null }); };
    c.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table]?.data ?? null, error: tables[table]?.error ?? null });
    return c;
  };
  return {
    inserts,
    service: {
      from: (t: string) => chain(t),
      rpc: (name: string) => Promise.resolve({ data: rpcs[name]?.data ?? null, error: rpcs[name]?.error ?? null }),
    } as never,
  };
}
const baseTables = (over: Record<string, Table> = {}): Record<string, Table> => ({
  agent_delegations: { data: [{ ad_account_id: ACCOUNT, enabled: true, revoked_at: null, expires_at: "2026-12-01T00:00:00Z" }] },
  ai_settings: { data: null }, ai_client_settings: { data: null }, client_profiles: { data: { goal: "mais visitas" } },
  ...over,
});
const baseRpcs = (over: Record<string, Table> = {}): Record<string, Table> => ({
  ai_month_cost: { data: 1 }, agency_ai_entitlement: { data: { allowed: true, budget_usd: 50, restricted: false } },
  service_client_hierarchy: { data: hierarchy }, ...over,
});
const live = (status = "ACTIVE") => vi.fn(async () => new Map([["900", { configuredStatus: status, effectiveStatus: status, dailyBudgetMinor: 10_000, accountExternalId: null }]]));
const model = (recs: unknown[] = [{ action: "pause_campaign", targetRef: "c1", evidenceRefs: ["c1"], confidence: "high",
  rationale: "Gasto de 800 com apenas 3 conversoes no periodo." }]) => ({
  decide: vi.fn(async () => ({ output: { summary: "Campanha c1 gastou 800 com 3 conversoes.", recommendations: recs }, usage: { inputTokens: 1000, outputTokens: 200 } })),
});
const scope = { agencyId: "ag", clientId: "cl" };

describe("ciclo de decisao", () => {
  it("fica desligado por padrao e nao toca banco nem modelo", async () => {
    const m = model();
    const { service } = fakeService(baseTables(), baseRpcs());
    expect(await runDecisionCycle(service, scope, { model: m, enabled: false, now: () => NOW })).toEqual({ ok: false, reason: "disabled" });
    expect(m.decide).not.toHaveBeenCalled();
  });
  it("sem delegacao vigente nao gasta IA", async () => {
    const m = model();
    const { service } = fakeService(baseTables({ agent_delegations: { data: [{ ad_account_id: ACCOUNT, enabled: true, revoked_at: "2026-10-01T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" }] } }), baseRpcs());
    expect(await runDecisionCycle(service, scope, { model: m, enabled: true, now: () => NOW })).toEqual({ ok: false, reason: "no_delegation" });
    expect(m.decide).not.toHaveBeenCalled();
  });
  it("respeita a cota mensal e falha fechado em erro de verificacao", async () => {
    const m = model();
    const over = fakeService(baseTables(), baseRpcs({ ai_month_cost: { data: 50 } }));
    expect(await runDecisionCycle(over.service, scope, { model: m, enabled: true, now: () => NOW })).toEqual({ ok: false, reason: "ai_budget" });
    const broken = fakeService(baseTables(), baseRpcs({ agency_ai_entitlement: { error: { code: "X" } } }));
    expect(await runDecisionCycle(broken.service, scope, { model: m, enabled: true, now: () => NOW })).toEqual({ ok: false, reason: "ai_unavailable" });
    expect(m.decide).not.toHaveBeenCalled();
  });
  it("sem leitura ao vivo da Meta nao decide", async () => {
    const m = model();
    const { service } = fakeService(baseTables(), baseRpcs());
    const r = await runDecisionCycle(service, scope, { model: m, enabled: true, now: () => NOW, liveState: async () => null });
    expect(r).toEqual({ ok: true, accounts: [{ adAccountId: ACCOUNT, status: "skipped", reason: "live_state_unavailable" }] });
    expect(m.decide).not.toHaveBeenCalled();
  });
  it("ciclo completo: registra custo e deixa a pausa aguardando aprovacao", async () => {
    stage.mockReset().mockResolvedValue({ id: "job9", deduplicated: false });
    const m = model();
    const { service, inserts } = fakeService(baseTables(), baseRpcs());
    const r = await runDecisionCycle(service, scope, { model: m, enabled: true, now: () => NOW, liveState: live() });
    expect(r.ok && r.accounts[0]).toMatchObject({ status: "done", stages: [{ ref: "c1", status: "awaiting_approval", jobId: "job9" }] });
    expect(inserts[0]).toMatchObject({ table: "ai_usage", row: { feature: "agent_decision", status: "ok", input_tokens: 1000, output_tokens: 200 } });
    expect(inserts[0]!.row.cost_usd).toBeGreaterThan(0);
    expect(stage.mock.calls[0]![1]).toMatchObject({ agencyId: "ag", clientId: "cl", adAccountId: ACCOUNT });
    expect(stage.mock.calls[0]![1].observationId).toMatch(/^[0-9a-f-]{36}$/);
    // O status AO VIVO da Meta e o que vai ao modelo: entidade ja pausada nao pode ser pausada.
    const sent = (m.decide.mock.calls[0] as unknown as [{ factsText: string }])[0].factsText;
    expect(sent).not.toContain(ACCOUNT);
    expect(sent).toContain("mais visitas");
  });
  it("entidade pausada ao vivo invalida a pausa proposta e nada e enfileirado", async () => {
    stage.mockReset();
    const { service } = fakeService(baseTables(), baseRpcs());
    const r = await runDecisionCycle(service, scope, { model: model(), enabled: true, now: () => NOW, liveState: live("PAUSED") });
    expect(r.ok && r.accounts[0]).toMatchObject({ status: "done", stages: [], rejected: 1 });
    expect(stage).not.toHaveBeenCalled();
  });
  it("saida invalida do modelo ainda registra o custo e nao enfileira", async () => {
    stage.mockReset();
    const { service, inserts } = fakeService(baseTables(), baseRpcs());
    const bad = { decide: async () => ({ output: { lixo: true }, usage: { inputTokens: 5, outputTokens: 5 } }) };
    const r = await runDecisionCycle(service, scope, { model: bad, enabled: true, now: () => NOW, liveState: live() });
    expect(r.ok && r.accounts[0]).toMatchObject({ status: "skipped", reason: "invalid_output" });
    expect(inserts[0]!.row.status).toBe("error");
    expect(stage).not.toHaveBeenCalled();
  });
});

describe("leitura ao vivo da Meta", () => {
  const liveTables = (): Record<string, Table> => ({
    meta_ad_accounts: { data: { meta_connection_id: "mc", external_id: "act_910" } },
    meta_connections: { data: { id: "mc", integration_id: "in", connected_at: "2026-10-01T00:00:00Z" } },
    integrations: { data: { id: "in", connection_status: "connected", health_status: "ok" } },
  });
  const edgeFetch = (campaigns: object[], adsets: object[]) => vi.fn(async (url: URL | string) =>
    new Response(JSON.stringify({ data: String(url).includes("/campaigns") ? campaigns : adsets }), { status: 200 }));

  it("le pela conta (edges) com GET, sem presumir orcamento ausente e ignorando ids que a Meta nao devolve", async () => {
    const { service } = fakeService(liveTables(), {});
    const fetchImpl = edgeFetch(
      [{ id: "900", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "12000" }],
      [{ id: "901", status: "PAUSED", effective_status: "ADSET_PAUSED" }, { id: "555", status: "ACTIVE", effective_status: "ACTIVE" }]);
    const map = await readLiveEntityState(service, { agencyId: "ag", clientId: "cl", adAccountId: ACCOUNT }, ["900", "901", "999"],
      { tokenLoader: async () => "tok", apiVersion: "v23.0", fetchImpl: fetchImpl as never });
    expect(map?.get("900")).toMatchObject({ dailyBudgetMinor: 12_000, configuredStatus: "ACTIVE", accountExternalId: "act_910" });
    expect(map?.get("901")).toMatchObject({ dailyBudgetMinor: null, configuredStatus: "PAUSED" });
    expect(map?.has("999")).toBe(false); // id inexistente nao derruba a leitura
    expect(map?.has("555")).toBe(false); // so o que foi pedido
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(c => ((c as unknown[])[1] as RequestInit | undefined)?.method !== "POST")).toBe(true);
    expect(fetchImpl.mock.calls.map(c => String(c[0])).join(" ")).not.toContain("end_time");
  });
  it("erro da Meta vira motivo curto, sem expor mensagem ou token", async () => {
    const { service } = fakeService(liveTables(), {});
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { code: 100, message: "token secreto abc" } }), { status: 400 }));
    const { readLiveEntityStateDetailed } = await import("@/modules/agent-executor/decision-live-state");
    const r = await readLiveEntityStateDetailed(service, { agencyId: "ag", clientId: "cl", adAccountId: ACCOUNT }, ["900"],
      { tokenLoader: async () => "tok-secreto", apiVersion: "v23.0", fetchImpl: bad as never });
    expect(r).toMatchObject({ ok: false, reason: "meta_error", detail: "http 400 code 100" });
    expect(JSON.stringify(r)).not.toMatch(/secret/);
  });
  it("integracao offline ou erro de token => null", async () => {
    const off = fakeService({
      meta_ad_accounts: { data: { meta_connection_id: "mc", external_id: "act_910" } },
      meta_connections: { data: { id: "mc", integration_id: "in", connected_at: "2026-10-01T00:00:00Z" } },
      integrations: { data: { id: "in", connection_status: "disconnected", health_status: "ok" } },
    }, {});
    expect(await readLiveEntityState(off.service, { agencyId: "a", clientId: "c", adAccountId: ACCOUNT }, ["900"],
      { tokenLoader: async () => "t", apiVersion: "v23.0" })).toBeNull();
  });
});
