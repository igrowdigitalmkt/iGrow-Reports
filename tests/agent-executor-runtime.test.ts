import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ loadAccessToken: vi.fn() }));
import { resolveAgentRuntime, probeMetaWritePermission } from "@/modules/agent-executor/runtime";

const agencyId = "10000000-0000-4000-8000-000000000001";
const clientId = "20000000-0000-4000-8000-000000000002";
const jobId = "30000000-0000-4000-8000-000000000003";
const delegationId = "40000000-0000-4000-8000-000000000004";
const adAccountId = "50000000-0000-4000-8000-000000000005";
const granter = "60000000-0000-4000-8000-000000000006";
const connectionId = "70000000-0000-4000-8000-000000000007";
const integrationId = "80000000-0000-4000-8000-000000000008";
const at = "2026-10-18T18:00:00Z";

type Row = Record<string, unknown>;
function fixtures(): Record<string, Row[]> {
  return {
    agent_action_jobs: [{
      id: jobId, agency_id: agencyId, client_id: clientId, ad_account_id: adAccountId,
      delegation_id: delegationId, policy_version: 1, status: "executing",
      execution_origin: "ai", approved_by: granter,
      approved_at: "2026-10-18T18:00:30Z",
      created_at: "2026-10-18T18:00:00Z", approval_expires_at: "2026-10-18T18:15:00Z",
      action_type: "pause_campaign", meta_entity_id: "111", daily_budget_minor: null,
      facts_collected_at: at, rationale: "Campanha fora da estrategia aprovada.",
    }],
    agent_delegations: [{
      id: delegationId, agency_id: agencyId, client_id: clientId, ad_account_id: adAccountId,
      granted_by: granter, enabled: true, revoked_at: null, expires_at: "2026-10-19T00:00:00Z",
      currency: "BRL", allowed_actions: ["pause_campaign", "resume_campaign"],
      max_account_daily_budget_minor: 30000, max_entity_daily_budget_minor: 10000,
      max_increase_minor_per_action: 2000, max_increase_percent_per_action: 20,
    }],
    client_ad_accounts: [{ agency_id: agencyId, client_id: clientId, ad_account_id: adAccountId, active: true }],
    clients: [{ agency_id: agencyId, id: clientId, archived_at: null }],
    agency_users: [{ agency_id: agencyId, user_id: granter, role: "owner" }],
    meta_ad_accounts: [{
      id: adAccountId, agency_id: agencyId, external_id: "act_123",
      meta_connection_id: connectionId, account_status: "1", currency: "BRL", archived_at: null,
    }],
    meta_connections: [{
      id: connectionId, agency_id: agencyId, client_id: clientId, integration_id: integrationId,
      scopes: ["ads_management", "ads_read"], connected_at: at,
    }],
    integrations: [{
      id: integrationId, agency_id: agencyId, provider: "meta",
      connection_status: "connected", health_status: "healthy",
    }],
  };
}
function fake(rows: Record<string, Row[]>, allowed = true) {
  const rpc = vi.fn(async () => ({ data: allowed, error: null }));
  const from = vi.fn((table: string) => {
    const predicates: Array<(row: Row) => boolean> = [];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        predicates.push(row => row[key] === value);
        return query;
      },
      is: (key: string, value: unknown) => {
        predicates.push(row => row[key] === value);
        return query;
      },
      single: async () => {
        const matches = (rows[table] ?? []).filter(row => predicates.every(p => p(row)));
        return { data: matches.length === 1 ? matches[0] : null, error: matches.length === 1 ? null : { code: "PGRST116" } };
      },
    };
    return query;
  });
  return { service: { rpc, from } as unknown as SupabaseClient<Database>, rpc, from };
}
const deps = () => ({
  now: () => new Date("2026-10-18T18:01:00Z"), apiVersion: "v26.0",
  tokenLoader: vi.fn(async () => "fake-not-real"),
  permissionProbe: vi.fn(async () => true),
});
const id = { agencyId, jobId };

describe("Agente: contexto exclusivamente server-only", () => {
  it("reconstroi proposal e delegacao somente das tabelas escopadas", async () => {
    const { service, rpc } = fake(fixtures());
    const trusted = deps();
    const runtime = await resolveAgentRuntime(service, id, trusted);
    expect(rpc).toHaveBeenCalledWith("agent_meta_execution_allowed", { p_agency_id: agencyId });
    expect(runtime.proposal).toMatchObject({ actionId: jobId, targetId: "111", adAccountId: "act_123" });
    expect(runtime.delegation.agencyId).toBe(agencyId);
    expect(runtime.context.budgetCoverageComplete).toBe(false);
    expect(trusted.tokenLoader).toHaveBeenCalledWith(service, agencyId, integrationId, connectionId);
  });
  it("pausa dispensa inventario; retomar le o inventario e preenche o contexto da politica", async () => {
    const reader = vi.fn(async () => ({ confirmedActiveDailyBudgetMinor: 12_000, coverageComplete: true, gaps: [] }));
    const pause = await resolveAgentRuntime(fake(fixtures()).service, id, { ...deps(), inventoryReader: reader });
    expect(reader).not.toHaveBeenCalled();
    expect(pause.context.budgetCoverageComplete).toBe(false);
    const rows = fixtures(); rows.agent_action_jobs[0]!.action_type = "resume_campaign";
    const resume = await resolveAgentRuntime(fake(rows).service, id, { ...deps(), inventoryReader: reader });
    expect(reader).toHaveBeenCalledWith("fake-not-real", "act_123", "v26.0");
    expect(resume.context).toMatchObject({ confirmedActiveDailyBudgetMinor: 12_000, budgetCoverageComplete: true });
  });
  it("inventario incompleto nunca vira orcamento confirmado", async () => {
    const rows = fixtures(); rows.agent_action_jobs[0]!.action_type = "resume_campaign";
    const runtime = await resolveAgentRuntime(fake(rows).service, id, { ...deps(),
      inventoryReader: async () => ({ confirmedActiveDailyBudgetMinor: 999, coverageComplete: false, gaps: ["lifetime_budget"] }) });
    expect(runtime.context).toMatchObject({ confirmedActiveDailyBudgetMinor: null, budgetCoverageComplete: false });
  });
  const manualRows = () => {
    const rows = fixtures();
    Object.assign(rows.agent_action_jobs[0]!, { execution_origin: "manual", requested_by: granter, delegation_id: null,
      approved_by: null, approved_at: null, approval_expires_at: null });
    return rows;
  };
  it("job manual so roda no caminho manual, com envelope derivado do pedido do usuario", async () => {
    await expect(resolveAgentRuntime(fake(manualRows()).service, id, deps())).rejects.toMatchObject({ code: "invalid_execution_origin" });
    const runtime = await resolveAgentRuntime(fake(manualRows()).service, id, { ...deps(), origin: "manual" });
    expect(runtime.delegation).toMatchObject({ allowedActions: ["pause_campaign"], enabled: true, revokedAt: null });
    expect(runtime.context.userMayDelegate).toBe(true);
  });
  it("job da IA nunca roda como manual e solicitante rebaixado nao executa", async () => {
    await expect(resolveAgentRuntime(fake(fixtures()).service, id, { ...deps(), origin: "manual" })).rejects.toMatchObject({ code: "invalid_execution_origin" });
    const demoted = manualRows();
    demoted.agency_users[0]!.role = "viewer";
    await expect(resolveAgentRuntime(fake(demoted).service, id, { ...deps(), origin: "manual" })).rejects.toMatchObject({ code: "requester_not_authorized" });
    const noRequester = manualRows();
    noRequester.agent_action_jobs[0]!.requested_by = null;
    await expect(resolveAgentRuntime(fake(noRequester).service, id, { ...deps(), origin: "manual" })).rejects.toMatchObject({ code: "missing_requester" });
  });
  it("bloqueia quando recurso comercial nao esta habilitado", async () => {
    const { service, from } = fake(fixtures(), false);
    const trusted = deps();
    await expect(resolveAgentRuntime(service, id, trusted)).rejects.toMatchObject({ code: "commercial_gate" });
    expect(from).not.toHaveBeenCalled();
    expect(trusted.tokenLoader).not.toHaveBeenCalled();
  });
  it("bloqueia vinculo entre clientes/contas divergente antes da credencial", async () => {
    const rows = fixtures();
    rows.client_ad_accounts[0].active = false;
    const trusted = deps();
    await expect(resolveAgentRuntime(fake(rows).service, id, trusted)).rejects.toMatchObject({ code: "inactive_link" });
    expect(trusted.tokenLoader).not.toHaveBeenCalled();
  });
  it("bloqueia conexao Meta de outro cliente", async () => {
    const rows = fixtures(); rows.meta_connections[0].client_id = "90000000-0000-4000-8000-000000000009";
    const trusted = deps();
    await expect(resolveAgentRuntime(fake(rows).service, id, trusted)).rejects.toMatchObject({ code: "connection_not_bound" });
    expect(trusted.tokenLoader).not.toHaveBeenCalled();
  });
  it("bloqueia concedente removido ou rebaixado", async () => {
    const rows = fixtures(); rows.agency_users[0].role = "viewer";
    await expect(resolveAgentRuntime(fake(rows).service, id, deps())).rejects.toMatchObject({ code: "approver_not_authorized" });
  });
  it("bloqueia ads_management historico ausente", async () => {
    const rows = fixtures(); rows.meta_connections[0].scopes = ["ads_read"];
    const trusted = deps();
    await expect(resolveAgentRuntime(fake(rows).service, id, trusted)).rejects.toMatchObject({ code: "connection_no_write_scope" });
    expect(trusted.permissionProbe).not.toHaveBeenCalled();
  });
  it("bloqueia quando Meta nao confirma ads_management ao vivo", async () => {
    const trusted = deps(); trusted.permissionProbe.mockResolvedValue(false);
    await expect(resolveAgentRuntime(fake(fixtures()).service, id, trusted)).rejects.toMatchObject({ code: "meta_permission" });
  });
  it("IA sem aprovacao humana registrada nunca recupera token Meta", async () => {
    const rows = fixtures(); rows.agent_action_jobs[0].approved_by = null;
    const trusted = deps();
    await expect(resolveAgentRuntime(fake(rows).service, id, trusted))
      .rejects.toMatchObject({ code: "financial_approval_required" });
    expect(trusted.tokenLoader).not.toHaveBeenCalled();
  });
  it("aprovação vencida bloqueia execução financeira", async () => {
    const rows = fixtures(); rows.agent_action_jobs[0].approval_expires_at = "2026-10-18T18:00:40Z";
    await expect(resolveAgentRuntime(fake(rows).service, id, deps()))
      .rejects.toMatchObject({ code: "financial_approval_required" });
  });
  it("job manual nao entra no worker autonomo da IA", async () => {
    const rows = fixtures(); rows.agent_action_jobs[0].execution_origin = "manual";
    await expect(resolveAgentRuntime(fake(rows).service, id, deps()))
      .rejects.toMatchObject({ code: "invalid_execution_origin" });
  });
  it("GET de permissoes e apenas leitura, sem token na URL", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => {
      void _url; void _options;
      return new Response(JSON.stringify({
        data: [{ permission: "ads_management", status: "granted" }],
      }), { status: 200 });
    });
    expect(await probeMetaWritePermission("fake-not-real", "v26.0", fetchImpl)).toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("fake-not-real");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });
});
