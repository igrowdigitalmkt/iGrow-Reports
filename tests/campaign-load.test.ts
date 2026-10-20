import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ analytics: vi.fn(), statuses: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/client-portal/context", () => ({
  requireClientDashboardAccess: async () => ({ supabase: { rpc: mocks.rpc }, access: { agencyId: "agency-1" } }),
}));
vi.mock("@/modules/client-portal/analytics", () => ({ getClientAnalytics: mocks.analytics }));
vi.mock("@/modules/client-portal/analytics-live", () => ({ getFreshClientAnalytics: async (input: { initial: unknown }) => input.initial }));
vi.mock("@/modules/meta/server", () => ({ getMetaEntityStatuses: mocks.statuses }));
import { loadCampaignsData } from "@/modules/campaigns/load";
import type { LiveReadReport } from "@/modules/meta/server";

const ACC = "eca7861e-9817-4456-8758-432c747e45e6";
const ACC2 = "eca7861e-9817-4456-8758-432c747e45e7";
const metric = (key: string, label: string, unit: "currency" | "integer" | "percent") => ({ key, label, unit, precision: 2, desirable: "neutral" as const });
const analytics = (status: "complete" | "partial" | "empty", extra: Record<string, unknown> = {}) => ({
  accounts: [{ id: ACC, name: "Conta A", currency: "BRL", timezoneName: "America/Sao_Paulo" }, { id: ACC2, name: "Conta B", currency: "BRL", timezoneName: "America/Sao_Paulo" }],
  selectedAccountIds: [ACC, ACC2], summary: {}, campaigns: [], warnings: [], metaAggregate: { confirmed: status === "complete", collectedAt: null, version: 1 },
  metrics: status === "complete" ? [metric("spend", "Investimento", "currency"), metric("impressions", "Impressões", "integer")] : [],
  coverage: { status, previousStatus: status, latestCollectedAt: "2026-10-19T12:00:00Z", coveredDays: 30, previousCoveredDays: 30, totalDays: 30 }, ...extra,
});
const live = (accounts: string[], failed: string[] = [], entities: LiveReadReport["entities"] = [
  { accountId: ACC, level: "campaign", id: "1", name: "Ativa na Meta", parentId: null, campaignId: "1" },
  { accountId: ACC, level: "adset", id: "10", name: "Conjunto", parentId: "1", campaignId: "1" },
  { accountId: ACC, level: "campaign", id: "2", name: "Pausada", parentId: null, campaignId: "2" },
]) => mocks.statuses.mockImplementation(async (_input, _thumbs, _catalog, raw: Record<string, unknown>, report: LiveReadReport) => {
  report.accountsRead.push(...accounts); report.accountsFailed.push(...failed);
  report.entities.push(...entities.filter(entity => accounts.includes(entity.accountId)));
  if (!accounts.length) return {}; // leitura que falhou não devolve estado nenhum
  raw[`${ACC}:campaign:1`] = { configured: "ACTIVE", status: "ACTIVE", issues: false, accountBlocked: false };
  raw[`${ACC}:adset:10`] = { configured: "ACTIVE", status: "ACTIVE", issues: false, accountBlocked: false };
  raw[`${ACC}:campaign:2`] = { configured: "PAUSED", status: "PAUSED", issues: false, accountBlocked: false };
  return { [`${ACC}:campaign:1`]: "ACTIVE", [`${ACC}:adset:10`]: "ACTIVE", [`${ACC}:campaign:2`]: "INACTIVE" };
});
let run = 0; // a leitura ao vivo é reaproveitada por cliente por alguns segundos: cada cenário usa um cliente próprio
const query = { periodo: "custom", from: "2026-09-19", to: "2026-10-18" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation((name: string) => name === "get_client_portal_data_context"
    ? { single: async () => ({ data: { timezone_name: "America/Sao_Paulo" } }) }
    : Promise.resolve({ data: [
      { key: "campaign:1", id: "1", level: "campaign", accountId: ACC, name: "Ativa na Meta", currency: "BRL", values: { spend: 120, impressions: 4000, "result:provider_known": 1 } },
      { key: "adset:10", id: "10", level: "adset", parentId: "1", campaignId: "1", accountId: ACC, name: "Conjunto", currency: "BRL", values: { spend: 120 } },
    ] }));
});

describe("catálogo operacional × métricas históricas", () => {
  it("catálogo disponível e métricas confirmadas: linhas com valores e nenhum aviso de pendência", async () => {
    mocks.analytics.mockResolvedValue(analytics("complete")); live([ACC, ACC2]);
    const data = await loadCampaignsData(`c${++run}`, query);
    expect(data).toMatchObject({ state: "ready", metricsState: "confirmed", live: { state: "ok" } });
    const campaign = data.rows.find(row => row.id === "1")!;
    expect(campaign.values.spend).toBe(120);
    expect(campaign.metricsPending).toBeUndefined();
    expect(data.rows.find(row => row.id === "2")!.values).toEqual({}); // sem linha confirmada: ausente, nunca zero
  });

  it("coleta incompleta com catálogo na Meta: as campanhas aparecem, com estado atual e SEM nenhum valor", async () => {
    mocks.analytics.mockResolvedValue(analytics("partial")); live([ACC, ACC2]);
    const data = await loadCampaignsData(`c${++run}`, query);
    expect(data.state).toBe("ready");
    expect(data.metricsState).toBe("pending");
    expect(data.rows.map(row => row.id).sort()).toEqual(["1", "10", "2"]);
    for (const row of data.rows) { expect(row.values).toEqual({}); expect(row.metricsPending).toBe(true); }
    expect(data.rows.find(row => row.id === "1")!.state.group).toBe("active");
    expect(data.rows.find(row => row.id === "2")!.state.group).toBe("paused");
    expect(mocks.rpc).not.toHaveBeenCalledWith("get_client_analytics_hierarchy", expect.anything()); // métricas de linha não são nem lidas
    expect(data.metrics.map(metric => metric.key)).toEqual(["spend", "reach", "impressions", "link_clicks", "ctr_link", "cpc_link", "cpm"]); // colunas existem; valores não
  });

  it("coleta incompleta e leitura parcial da Meta: mostra o que a Meta devolveu e avisa que faltam contas", async () => {
    mocks.analytics.mockResolvedValue(analytics("partial")); live([ACC], [ACC2]);
    const data = await loadCampaignsData(`c${++run}`, query);
    expect(data).toMatchObject({ state: "ready", metricsState: "pending", live: { state: "partial", accountsRead: 1, accountsTotal: 2 } });
    expect(data.message).toContain("1 conta(s)");
    expect(data.rows.every(row => row.accountId === ACC)).toBe(true); // nada inventado para a conta que falhou
  });

  it("coleta incompleta e Meta indisponível: sem catálogo confiável, estado próprio e nenhuma linha (nunca dado antigo)", async () => {
    mocks.analytics.mockResolvedValue(analytics("partial")); live([], [ACC, ACC2]);
    const data = await loadCampaignsData(`c${++run}`, query);
    expect(data.state).toBe("blocked");
    expect(data.rows).toEqual([]);
    expect(data.message).toContain("não foi possível ler as campanhas na Meta");
  });

  it("métricas confirmadas e Meta indisponível: dados históricos aparecem e o estado atual fica Indisponível", async () => {
    mocks.analytics.mockResolvedValue(analytics("complete")); live([], [ACC, ACC2]);
    const data = await loadCampaignsData(`c${++run}`, query);
    expect(data).toMatchObject({ state: "ready", metricsState: "confirmed", live: { state: "unavailable" } });
    expect(data.rows.find(row => row.id === "1")!.values.spend).toBe(120);
    expect(data.rows.find(row => row.id === "1")!.state.group).toBe("unavailable");
    expect(data.message).toContain("Não foi possível consultar o estado atual na Meta");
  });

  it("conta sem campanhas na Meta: lista vazia e pronta (não é erro)", async () => {
    mocks.analytics.mockResolvedValue(analytics("partial")); live([ACC, ACC2], [], []);
    const data = await loadCampaignsData(`c${++run}`, query);
    expect(data).toMatchObject({ state: "ready", metricsState: "pending", rows: [] });
  });

  it("cliente sem contas Meta e sem contas selecionadas", async () => {
    mocks.analytics.mockResolvedValue(analytics("complete", { accounts: [], selectedAccountIds: [] }));
    expect((await loadCampaignsData(`c${++run}`, query)).state).toBe("no-accounts");
    mocks.analytics.mockResolvedValue(analytics("partial", { selectedAccountIds: [] }));
    const none = await loadCampaignsData(`c${++run}`, query);
    expect(none.state).toBe("blocked");
    expect(none.rows).toEqual([]);
  });

  it("falha inesperada vira estado de erro genérico, sem vazar detalhes", async () => {
    mocks.analytics.mockRejectedValue(new Error("segredo interno"));
    const data = await loadCampaignsData(`c${++run}`, query);
    expect(data.state).toBe("error");
    expect(JSON.stringify(data)).not.toContain("segredo");
  });
});
