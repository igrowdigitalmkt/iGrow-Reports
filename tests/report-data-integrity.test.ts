import { describe, expect, it, vi } from "vitest";
vi.mock("@/modules/client-portal/report-actions", () => ({ getSavedReportDocument: vi.fn() }));
import { buildDashboardPdf } from "@/modules/reports/pdf-download";
import { confirmedReportData, reportResultCosts, reportUpdatedAt } from "@/modules/reports/report-presentation";
import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";

const messages = "result:provider:action:onsite_conversion.messaging_conversation_started_7d";
const engagement = "result:provider:action:post_engagement";
const metric = (key: string, label: string, unit: "currency" | "integer") => ({ key, label, unit, precision: unit === "currency" ? 2 : 0, desirable: "neutral" });
const metrics = [metric("spend", "Valor usado", "currency"), metric("primary_results", "Resultados", "integer"), metric("cost_per_result", "Custo por resultado", "currency"), metric("link_clicks", "Cliques no link", "integer"), metric("impressions", "Impressões", "integer")];
const values = (spend: number, key: string, count: number) => ({ spend, "result:provider_known": 1, [key]: count });
const sources = [values(100, messages, 10), values(100, messages, 0), values(100, engagement, 50)];
const data = normalizeClientAnalytics({ dateFrom: "2026-09-01", dateTo: "2026-09-30", currency: "BRL", selectedAccountIds: ["a"], metrics,
  summary: { spend: 300, "result:provider_known": 1, [messages]: 10, [engagement]: 50, primary_results: 60, cost_per_result: 7.5 },
  campaigns: sources.map((values, index) => ({ id: String(index), name: `Campanha ${index}`, accountId: "a", accountName: "Conta", currency: "BRL", values })),
  coverage: { status: "complete", previousStatus: "empty", coveredDays: 30, totalDays: 30, latestCollectedAt: "2026-10-03T12:00:00Z" },
});
describe("integridade entre dashboard e relatórios", () => {
  it("restaura apenas outcomes confirmados e remove totais de objetivos mistos legados", () => {
    const frozen = confirmedReportData({ ...data, summary: { ...data.summary, primary_results: 60, cost_per_result: 7.5 } });
    expect(frozen.summary.primary_results).toBeNull();
    expect(frozen.summary.cost_per_result).toBeNull();
    expect(confirmedReportData({ ...data, summary: { spend: 300, primary_results: 99, "action:lead": 99 } }).summary.primary_results).toBeNull();
  });
  it("usa os mesmos custos por família com fontes de campanha ou árvore completa", () => {
    const tree: AnalyticsEntity[] = data.campaigns.flatMap(campaign => [
      { ...campaign, key: `campaign:${campaign.id}`, level: "campaign" as const, parentId: null, campaignId: campaign.id },
      { ...campaign, id: `s${campaign.id}`, key: `adset:s${campaign.id}`, level: "adset" as const, parentId: campaign.id, campaignId: campaign.id },
    ]);
    expect(reportResultCosts(data, tree)).toEqual(reportResultCosts(data));
    expect(reportResultCosts(data).map(row => row.cost)).toEqual([20, 2]);
  });
  it("publica custos por família iguais nos dois formatos sem custo misturado", () => {
    for (const orientation of ["vertical", "horizontal"] as const) {
      const document = buildDashboardPdf({ data, metrics: data.metrics, title: "Auditoria", clientName: "Cliente", workspaceName: "iGrow", headerDetails: "", entityLabels: ["Todas as campanhas"], accountLabels: ["Conta"], comparison: false, chartType: "line", orientation });
      const content = document.output();
      expect(content).toContain("20,00");
      expect(content).toContain("2,00");
      expect(content).not.toContain("7,50");
      expect(content).not.toContain("0 cliques no link em 0");
    }
  });
  it("mostra a atualização Meta mais recente em vez da coleta diária antiga", () => {
    expect(reportUpdatedAt({ ...data, metaAggregate: { confirmed: true, version: 7, collectedAt: "2026-10-03T15:00:00Z" } })).toContain("12:00:00");
  });
});
