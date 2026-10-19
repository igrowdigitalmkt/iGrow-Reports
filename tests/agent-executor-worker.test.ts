import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ loadAccessToken: vi.fn() }));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AgentRuntime } from "@/modules/agent-executor/runtime";
import type { MetaWriteDeps } from "@/modules/agent-executor/meta-write";
import { runQueuedAgentJob } from "@/modules/agent-executor/worker";

const identity = { agencyId: "10000000-0000-4000-8000-000000000001",
  jobId: "30000000-0000-4000-8000-000000000003" };
const runtime = {
  token: "fake-not-real", apiVersion: "v26.0", targetId: "111",
  proposal: {
    actionId: identity.jobId, action: "pause_campaign", targetId: "111",
    adAccountId: "act_123", factsCollectedAt: "2026-10-18T18:00:00Z",
    rationale: "Campanha excedeu custo considerado aceitavel.",
  },
  delegation: {
    agencyId: identity.agencyId, clientId: "20000000-0000-4000-8000-000000000002",
    adAccountId: "act_123", enabled: true, revokedAt: null,
    expiresAt: "2026-10-19T12:00:00Z", allowedActions: ["pause_campaign"],
    maxAccountDailyBudgetMinor: 30000, maxEntityDailyBudgetMinor: 10000,
    maxIncreaseMinorPerAction: 2000, maxIncreasePercentPerAction: 10,
  },
  context: {
    agencyId: identity.agencyId, clientId: "20000000-0000-4000-8000-000000000002",
    adAccountId: "act_123", currency: "BRL", hasWritePermission: true,
    userMayDelegate: true, commercialAccessActive: true, metaConnectionActive: true,
    confirmedActiveDailyBudgetMinor: null, budgetCoverageComplete: false,
  },
} as AgentRuntime;

function fakeStore() {
  const ledger: Record<string, unknown> = { status: "queued", before_state: null, after_state: null };
  const history: string[] = [];
  const rpc = vi.fn(async (name: string) => {
    if (name !== "agent_claim_action" || ledger.status !== "queued") return { data: false, error: null };
    ledger.status = "executing"; history.push("executing");
    return { data: true, error: null };
  });
  const from = vi.fn(() => {
    let patch: Record<string, unknown> = {};
    const equalities: Record<string, unknown> = {};
    const q = {
      update(data: Record<string, unknown>) { patch = data; return q; },
      eq(column: string, value: unknown) { equalities[column] = value; return q; },
      select(columns: string) { void columns; return q; },
      async maybeSingle() {
        if (equalities.status !== ledger.status || equalities.id !== identity.jobId
          || equalities.agency_id !== identity.agencyId) return { data: null, error: null };
        Object.assign(ledger, patch);
        if ("status" in patch) history.push(String(patch.status));
        return { data: { id: identity.jobId }, error: null };
      },
    };
    return q;
  });
  return { service: { rpc, from } as unknown as SupabaseClient<Database>, ledger, history, rpc };
}
const resolver = vi.fn(async () => runtime);
const op = {
  actionId: identity.jobId, action: "pause_campaign", targetId: "111",
  adAccountId: "act_123", previousStatus: "ACTIVE",
  previousDailyBudgetMinor: 1000, requestedDailyBudgetMinor: null, rationale: runtime.proposal.rationale,
} as const;

describe("Worker: transacoes e nunca duplicar POST", () => {
  it("claim unico, snapshots duraveis e transicoes ate verificado", async () => {
    const store = fakeStore();
    const writer = vi.fn(async (_input: unknown, deps: MetaWriteDeps) => {
      await deps.beforePost!(op, { status: "ACTIVE", dailyBudgetMinor: 1000 });
      expect(store.ledger.before_state).toMatchObject({ previous_status: "ACTIVE" });
      await deps.afterVerified!(op, { status: "PAUSED", dailyBudgetMinor: 1000 });
      return { status: "verified" as const, actionId: identity.jobId, metaEntityId: "111" };
    });
    const first = await runQueuedAgentJob(identity, {
      service: store.service, resolver, writer: writer as typeof import("@/modules/agent-executor/meta-write").executeMetaWrite,
    });
    expect(first.status).toBe("verified");
    expect(store.history).toEqual(["executing", "verifying", "verified"]);
    expect(store.ledger.after_state).toMatchObject({ confirmed_status: "PAUSED" });
    expect((await runQueuedAgentJob(identity, { service: store.service, resolver, writer: writer as typeof import("@/modules/agent-executor/meta-write").executeMetaWrite })).status).toBe("not_claimed");
    expect(writer).toHaveBeenCalledTimes(1);
  });
  it("resultado incerto trava job e nunca repete a alteracao", async () => {
    const store = fakeStore();
    const writer = vi.fn(async () => ({ status: "needs_verification" as const,
      actionId: identity.jobId, metaEntityId: "111", detail: "estado incerto" }));
    expect((await runQueuedAgentJob(identity, {
      service: store.service, resolver, writer: writer as typeof import("@/modules/agent-executor/meta-write").executeMetaWrite,
    })).status).toBe("needs_verification");
    expect(store.ledger.status).toBe("needs_verification");
    expect((await runQueuedAgentJob(identity, { service: store.service })).status).toBe("not_claimed");
    expect(writer).toHaveBeenCalledTimes(1);
  });
  it("preflight negado encerra sem chamar executor Meta", async () => {
    const store = fakeStore();
    const writer = vi.fn();
    const result = await runQueuedAgentJob(identity, {
      service: store.service, resolver: async () => { throw new Error("denied"); },
      writer: writer as typeof import("@/modules/agent-executor/meta-write").executeMetaWrite,
    });
    expect(result.status).toBe("failed");
    expect(store.ledger.failure_code).toBe("preflight_denied");
    expect(writer).not.toHaveBeenCalled();
  });
});
