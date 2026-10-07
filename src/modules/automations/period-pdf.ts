import "server-only";

import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { buildDashboardPdf } from "@/modules/reports/pdf-download";

// Same indicators the dashboard shows by default, in the same order.
const PDF_METRICS = ["spend", "primary_results", "cost_per_result", "reach", "impressions", "cpm", "link_clicks", "ctr_link", "cpc_link", "frequency"];

export class PeriodPdfUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "PeriodPdfUnavailableError"; }
}

const brDate = (value: string) => value.split("-").reverse().join("/");

/** PDF of the period for a scheduled send, with the same layout as the downloaded report. */
export function buildPeriodPdf(input: { clientName: string; workspaceName: string; data: AnalyticsDashboardData }) {
  if (input.data.coverage.status !== "complete") throw new PeriodPdfUnavailableError("Os dados do período ainda não estão completos para gerar o PDF.");
  const metrics = PDF_METRICS.flatMap(key => input.data.metrics.filter(metric => metric.key === key));
  const period = `${brDate(input.data.dateFrom)} a ${brDate(input.data.dateTo)}`;
  const doc = buildDashboardPdf({
    title: "Relatório de desempenho", clientName: input.clientName, workspaceName: input.workspaceName,
    headerDetails: `Período: ${period}`, data: input.data, metrics: metrics.length ? metrics : input.data.metrics.slice(0, 8),
    entityLabels: ["Todas as campanhas"],
    accountLabels: input.data.accounts.filter(account => input.data.selectedAccountIds.includes(account.id)).map(account => account.name),
    comparison: false, chartType: "line",
  });
  const safeName = input.clientName.replace(/[^\p{L}\p{N} _-]/gu, "").trim().replace(/\s+/g, "-").slice(0, 80) || "relatorio";
  return {
    blob: new Blob([doc.output("arraybuffer")], { type: "application/pdf" }),
    filename: `${safeName}-${input.data.dateFrom}-${input.data.dateTo}.pdf`,
    period,
  };
}
