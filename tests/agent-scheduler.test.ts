import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ loadAccessToken: vi.fn() }));
const recon = vi.hoisted(() => vi.fn(async () => [{ jobId: "r1", outcome: "verified" }]));
vi.mock("@/modules/agent-executor/reconciler", () => ({ reconcileUncertainJobs: recon }));
const cycle = vi.hoisted(() => vi.fn(async () => ({ ok: true, accounts: [] })));
vi.mock("@/modules/agent-executor/decision-cycle", () => ({ runDecisionCycle: cycle }));

import { agentSchedulerEnabled, runAgentScheduler } from "@/modules/agent-executor/scheduler";

const NOW = new Date("2026-10-19T12:00:00Z");
function fake(tables: Record<string, unknown[]>, gate: Record<string, boolean> = {}) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    service: {
      rpc: async (_: string, a: { p_agency_id: string }) => ({ data: gate[a.p_agency_id] === true, error: null }),
      from: (table: string) => {
        const q: Record<string, unknown> = {};
        let update = false;
        for (const m of ["select", "eq", "neq", "lt", "gte", "order"]) q[m] = () => q;
        q.update = (p: Record<string, unknown>) => { update = true; updates.push(p); return q; };
        const rows = () => Promise.resolve({ data: update ? [] : (tables[table] ?? []), error: null });
        q.limit = rows;
        q.then = (r: (v: unknown) => void) => rows().then(r);
        return q;
      },
    } as never,
  };
}
afterEach(() => { vi.unstubAllEnvs(); recon.mockClear(); cycle.mockClear(); });

describe("agendador do agente", () => {
  it("desligado por padrao: nao toca banco, Meta nem IA", async () => {
    expect(agentSchedulerEnabled({})).toBe(false);
    const f = fake({});
    expect(await runAgentScheduler(f.service, { now: () => NOW })).toEqual({ enabled: false });
    expect(recon).not.toHaveBeenCalled();
    expect(f.updates).toEqual([]);
  });
  it("com o gate comercial desligado nao reivindica jobs; com gate ligado executa na origem certa", async () => {
    vi.stubEnv("AGENT_SCHEDULER_ENABLED", "true");
    const jobs = [{ id: "j1", agency_id: "A", execution_origin: "ai" }, { id: "j2", agency_id: "B", execution_origin: "manual" }];
    const runJob = vi.fn(async (identity: { jobId: string }) => ({ status: "verified" as const, jobId: identity.jobId }));
    const f = fake({ agent_action_jobs: jobs }, { B: true });
    const report = await runAgentScheduler(f.service, { now: () => NOW, runJob, decisionsEnabled: false });
    expect(report).toMatchObject({ enabled: true, skippedByGate: 1 });
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob).toHaveBeenCalledWith({ agencyId: "B", jobId: "j2" }, expect.objectContaining({ runtimeDeps: { origin: "manual" } }));
    expect(recon).toHaveBeenCalledTimes(1);
  });
  it("expira prazos e so analisa clientes com delegacao, sem pendencia e fora do cooldown", async () => {
    vi.stubEnv("AGENT_SCHEDULER_ENABLED", "true");
    const grant = (client: string) => ({ agency_id: "A", client_id: client, enabled: true, revoked_at: null, expires_at: "2026-12-01T00:00:00Z" });
    const f = fake({ agent_delegations: [grant("c1")] });
    const report = await runAgentScheduler(f.service, { now: () => NOW, decisionsEnabled: true, model: { decide: vi.fn() } });
    expect(f.updates.filter(u => u.status === "expired")).toHaveLength(2);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ enabled: true, decisions: { clients: 1, analyzed: 1 } });
    const busy = fake({ agent_delegations: [grant("c1")], agent_action_jobs: [{ id: "p" }] });
    cycle.mockClear();
    await runAgentScheduler(busy.service, { now: () => NOW, decisionsEnabled: true, model: { decide: vi.fn() } });
    expect(cycle).not.toHaveBeenCalled();
  });
});
