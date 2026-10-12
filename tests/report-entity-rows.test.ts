import { describe, expect, it, vi } from "vitest";
vi.mock("@/modules/client-portal/report-actions", () => ({ getSavedReportDocument: vi.fn() }));
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { buildDashboardPdf } from "@/modules/reports/pdf-download";
import { reportedEntityRows } from "@/modules/reports/report-presentation";

const entity = (id: number, spend: number | null): AnalyticsEntity => ({
  key: `ad:${id}`, id: String(id), level: "ad", name: `Anúncio ${id}`, parentId: null, campaignId: null,
  accountId: "a", accountName: "Conta", currency: "BRL", values: { spend, reach: spend ? 1000 : 0, impressions: spend ? 2000 : 0 },
});

const data: AnalyticsDashboardData = {
  dateFrom: "2026-09-30", dateTo: "2026-10-06", previousDateFrom: "2026-09-23", previousDateTo: "2026-09-29", currency: "BRL", timezoneName: "America/Sao_Paulo",
  primaryMetricKey: null, primaryActionType: null, accounts: [], selectedAccountIds: ["a"],
  summary: { spend: 300, reach: 3000, impressions: 6000 }, previousSummary: {}, daily: [], previousDaily: [],
  accountTotals: [{ id: "a", name: "Conta", currency: "BRL", values: { spend: 300 } }], campaigns: [],
  metrics: [{ key: "spend", label: "Valor usado", unit: "currency", precision: 2, desirable: "neutral" }, { key: "reach", label: "Alcance", unit: "integer", precision: 0, desirable: "up" }],
  coverage: { status: "complete", previousStatus: "partial", latestCollectedAt: null, coveredDays: 7, previousCoveredDays: 0, totalDays: 7 }, warnings: [],
};
const input = (rows: AnalyticsEntity[]) => ({ title: "Relatório", clientName: "Cliente", workspaceName: "Espaço", headerDetails: "", data, metrics: data.metrics,
  entityLabels: ["Todas as campanhas"], accountLabels: ["Conta"], comparison: false, chartType: "line" as const, entityRows: rows });

describe("tabela de entidades do PDF antigo", () => {
  it("só entra quem teve investimento no período", () => {
    const rows = [entity(1, 100), entity(2, 0), entity(3, null), entity(4, 200), entity(5, Number.NaN)];
    expect(reportedEntityRows(rows).map(row => row.id)).toEqual(["1", "4"]);
    expect(reportedEntityRows(undefined)).toEqual([]);
  });

  it("centenas de entidades sem gasto não viram centenas de páginas", () => {
    const idle = Array.from({ length: 700 }, (_, i) => entity(1000 + i, 0));
    const withIdle = buildDashboardPdf(input([entity(1, 100), entity(2, 200), ...idle])).getNumberOfPages();
    const without = buildDashboardPdf(input([entity(1, 100), entity(2, 200)])).getNumberOfPages();
    expect(withIdle).toBe(without);
    expect(withIdle).toBeLessThan(8);
  });
});
