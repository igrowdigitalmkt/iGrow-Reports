import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { stageMetaDecision } from "@/modules/agent-executor/queue";

const agencyId = "10000000-0000-4000-8000-000000000001";
const clientId = "20000000-0000-4000-8000-000000000002";
const accountId = "30000000-0000-4000-8000-000000000003";
const grantId = "40000000-0000-4000-8000-000000000004";
const userId = "50000000-0000-4000-8000-000000000005";
const connectionId = "60000000-0000-4000-8000-000000000006";
const integrationId = "70000000-0000-4000-8000-000000000007";
const scope = {
  agencyId, clientId, adAccountId: accountId,
  observationId: "80000000-0000-4000-8000-000000000008",
  factsCollectedAt: "2026-10-18T18:00:00Z",
};
const decision = { action: "pause_campaign", targetId: "111", rationale: "Pausar diante de desvio confirmado." };
type Row = Record<string, unknown>;

function fake(allowed = true) {
  const jobs: Row[] = [];
  const rows: Record<string, Row[]> = {
    client_ad_accounts: [{ agency_id: agencyId, client_id: clientId, ad_account_id: accountId, active: true }],
    agent_delegations: [{
      id: grantId, agency_id: agencyId, client_id: clientId, ad_account_id: accountId,
      granted_by: userId, enabled: true, revoked_at: null, expires_at: "2026-10-19T00:00:00Z",
      currency: "BRL", allowed_actions: ["pause_campaign"],
    }],
    meta_ad_accounts: [{
      id: accountId, agency_id: agencyId, external_id: "act_123", currency: "BRL",
      meta_connection_id: connectionId, account_status: "1", archived_at: null,
    }],
    agency_users: [{ agency_id: agencyId, user_id: userId, role: "owner" }],
    meta_connections: [{
      id: connectionId, agency_id: agencyId, client_id: clientId, integration_id: integrationId,
      scopes: ["ads_management"], connected_at: "2026-10-18T17:00:00Z",
    }],
    integrations: [{
      id: integrationId, agency_id: agencyId, provider: "meta",
      connection_status: "connected", health_status: "healthy",
    }],
    agent_action_jobs: jobs,
  };
  const db = {
    rpc: vi.fn(async () => ({ data: allowed, error: null })),
    from: vi.fn((name: string) => {
      const checks: Array<(row: Row) => boolean> = [];
      let update: Row | null = null;
      const q = {
        select(columns: string) { void columns; return q; },
        eq(key: string, value: unknown) { checks.push(row => row[key] === value); return q; },
        is(key: string, value: unknown) { checks.push(row => row[key] === value); return q; },
        async single() {
          const matches = (rows[name] ?? []).filter(row => checks.every(f => f(row)));
          return { data: matches.length === 1 ? matches[0] : null, error: matches.length === 1 ? null : { code: "PGRST116" } };
        },
        async maybeSingle() {
          const matches = (rows[name] ?? []).filter(row => checks.every(f => f(row)));
          if (matches.length !== 1) return { data: null, error: null };
          if (update) Object.assign(matches[0], update);
          return { data: matches[0], error: null };
        },
        async insert(row: Row) {
          if (jobs.some(job => job.idempotency_key === row.idempotency_key))
            return { error: { code: "23505" } };
          jobs.push({ ...row, status: "proposed" });
          return { error: null };
        },
        update(patch: Row) { update = patch; return q; },
      };
      return q;
    }),
  };
  return { service: db as unknown as SupabaseClient<Database>, rows, jobs, db };
}

describe("Fila segura de decisoes (sem POST Meta)", () => {
  it("valida vinculos e registra proposed→authorized→queued", async () => {
    const data = fake();
    const outcome = await stageMetaDecision(data.service, scope, decision, new Date("2026-10-18T18:02:00Z"));
    expect(outcome.deduplicated).toBe(false);
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0]).toMatchObject({ status: "queued", action_type: "pause_campaign", meta_entity_id: "111" });
    expect(data.jobs[0].idempotency_key).toMatch(/^[a-f0-9]{64}$/);
  });
  it("mesmo ciclo e mesma acao nao criam nova operacao", async () => {
    const data = fake();
    const first = await stageMetaDecision(data.service, scope, decision, new Date("2026-10-18T18:02:00Z"));
    const again = await stageMetaDecision(data.service, scope, decision, new Date("2026-10-18T18:02:00Z"));
    expect(again).toEqual({ id: first.id, deduplicated: true });
    expect(data.jobs).toHaveLength(1);
  });
  it("feature desabilitada bloqueia sem criar job", async () => {
    const data = fake(false);
    await expect(stageMetaDecision(data.service, scope, decision, new Date("2026-10-18T18:02:00Z")))
      .rejects.toMatchObject({ code: "commercial_gate" });
    expect(data.jobs).toHaveLength(0);
  });
  it("delegacao revogada bloqueia", async () => {
    const data = fake(); data.rows.agent_delegations[0].revoked_at = "2026-10-18T18:01:00Z";
    await expect(stageMetaDecision(data.service, scope, decision, new Date("2026-10-18T18:02:00Z")))
      .rejects.toMatchObject({ code: "delegation_ineligible" });
  });
  it("nao enfileira orcamento sem inventario financeiro", async () => {
    const data = fake();
    await expect(stageMetaDecision(data.service, scope, {
      action: "set_campaign_daily_budget", targetId: "111", dailyBudgetMinor: 1000,
      rationale: "Aumentar orcamento, mas sem cobertura financeira.",
    }, new Date("2026-10-18T18:02:00Z"))).rejects.toMatchObject({ code: "financial_inventory_pending" });
    expect(data.db.rpc).not.toHaveBeenCalled();
  });
});
