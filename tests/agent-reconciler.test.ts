import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const readLive = vi.hoisted(() => vi.fn());
vi.mock("@/modules/agent-executor/decision-live-state", () => ({ readLiveEntityState: readLive }));

import { classifyReconciliation, reconcileUncertainJobs } from "@/modules/agent-executor/reconciler";

const NOW = new Date("2026-10-19T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ACC = "act_77";
const baseJob = (over: Record<string, unknown> = {}) => ({
  id: "j1", agency_id: "ag", client_id: "cl", ad_account_id: "ac", status: "needs_verification",
  action_type: "pause_campaign", meta_entity_id: "900", daily_budget_minor: null, execution_origin: "ai",
  before_state: { previous_status: "ACTIVE", previous_daily_budget_minor: 5000 },
  started_at: ago(30), created_at: ago(40), ...over,
});
const live = (over: Record<string, unknown> = {}) => ({
  configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", dailyBudgetMinor: 5000, accountExternalId: ACC, ...over,
});

describe("classificacao conservadora", () => {
  const c = (job: object, l: object | undefined, now = NOW) => classifyReconciliation(job as never, l as never, ACC, now);
  it("aplicada: estado final igual ao pretendido e diferente do anterior", () => {
    expect(c(baseJob(), live({ configuredStatus: "PAUSED" }))).toBe("applied");
    const budget = baseJob({ action_type: "set_campaign_daily_budget", daily_budget_minor: 6000 });
    expect(c(budget, live({ dailyBudgetMinor: 6000 }))).toBe("applied");
  });
  it("nao aplicada somente depois da espera de consistencia", () => {
    expect(c(baseJob(), live())).toBe("not_applied");
    expect(c(baseJob({ started_at: ago(3) }), live())).toBe("too_soon");
  });
  it("inconclusiva: leitura ausente, conta divergente, estado de terceiros ou sem before_state", () => {
    expect(c(baseJob(), undefined)).toBe("inconclusive");
    expect(c(baseJob(), live({ accountExternalId: "act_1" }))).toBe("inconclusive");
    expect(c(baseJob(), live({ configuredStatus: "ARCHIVED" }))).toBe("inconclusive");
    expect(c(baseJob({ before_state: null }), live())).toBe("inconclusive");
    expect(c(baseJob({ action_type: "set_campaign_daily_budget", daily_budget_minor: 6000 }), live({ dailyBudgetMinor: 7000 }))).toBe("inconclusive");
  });
});

function fakeService(jobs: Record<string, unknown>[]) {
  const updates: { id: string; from: unknown; patch: Record<string, unknown> }[] = [];
  return {
    updates,
    service: {
      from: (table: string) => {
        if (table === "agent_action_jobs") {
          let patch: Record<string, unknown> | null = null; const f: Record<string, unknown> = {};
          const q: Record<string, unknown> = {
            select: () => q, in: () => q, order: () => q,
            limit: () => Promise.resolve({ data: jobs, error: null }),
            update: (p: Record<string, unknown>) => { patch = p; return q; },
            eq: (k: string, v: unknown) => { f[k] = v; return q; },
            maybeSingle: () => {
              const job = jobs.find(j => j.id === f.id && j.status === f.status);
              if (!job || !patch) return Promise.resolve({ data: null, error: null });
              updates.push({ id: String(job.id), from: job.status, patch });
              Object.assign(job, patch);
              return Promise.resolve({ data: { id: job.id }, error: null });
            },
          };
          return q;
        }
        const t: Record<string, unknown> = { select: () => t, eq: () => t, maybeSingle: () => Promise.resolve({ data: { external_id: ACC }, error: null }) };
        return t;
      },
    } as never,
  };
}
const run = (jobs: Record<string, unknown>[]) => {
  const f = fakeService(jobs);
  return reconcileUncertainJobs(f.service, { now: () => NOW }).then(reports => ({ reports, ...f }));
};

describe("reconciliador", () => {
  it("aplicada: verifica a partir de needs_verification e grava prova marcada como conciliada", async () => {
    readLive.mockReset().mockResolvedValue(new Map([["900", live({ configuredStatus: "PAUSED" })]]));
    const { reports, updates } = await run([baseJob()]);
    expect(reports).toEqual([{ jobId: "j1", outcome: "verified" }]);
    expect(updates[0]!.patch).toMatchObject({ status: "verified", failure_code: null, after_state: { reconciled: true, confirmed_status: "PAUSED" } });
  });
  it("executing travado passa por verifying antes de verified", async () => {
    readLive.mockReset().mockResolvedValue(new Map([["900", live({ configuredStatus: "PAUSED" })]]));
    const { updates } = await run([baseJob({ status: "executing" })]);
    expect(updates.map(u => u.patch.status)).toEqual(["verifying", "verified"]);
  });
  it("nao aplicada: falha e libera a trava, sem qualquer escrita na Meta", async () => {
    readLive.mockReset().mockResolvedValue(new Map([["900", live()]]));
    const { reports, updates } = await run([baseJob()]);
    expect(reports[0]!.outcome).toBe("failed_not_applied");
    expect(updates[0]!.patch).toEqual({ status: "failed", failure_code: "reconciled_not_applied" });
  });
  it("executing sem before_state e antigo: nada foi enviado, falha sem consultar a Meta", async () => {
    readLive.mockReset();
    const { reports, updates } = await run([baseJob({ status: "executing", before_state: null })]);
    expect(reports[0]!.outcome).toBe("failed_not_sent");
    expect(updates[0]!.patch.failure_code).toBe("reconciled_not_sent");
    expect(readLive).not.toHaveBeenCalled();
  });
  it("executing recente nao e tocado", async () => {
    readLive.mockReset();
    const { reports, updates } = await run([baseJob({ status: "executing", started_at: ago(2) })]);
    expect(reports[0]!.outcome).toBe("too_soon");
    expect(updates).toEqual([]);
  });
  it("leitura indisponivel mantem o job bloqueando a conta", async () => {
    readLive.mockReset().mockResolvedValue(null);
    const { reports, updates } = await run([baseJob()]);
    expect(reports[0]!.outcome).toBe("inconclusive");
    expect(updates).toEqual([]);
  });
  it("ignora jobs de origem manual", async () => {
    readLive.mockReset();
    const { reports, updates } = await run([baseJob({ execution_origin: "manual" })]);
    expect(reports[0]!.outcome).toBe("inconclusive");
    expect(updates).toEqual([]);
  });
});
