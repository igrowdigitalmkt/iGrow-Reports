import { aggregateResults, resultBreakdown, resultCostBreakdown } from "@/modules/client-portal/analytics-results";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";

export function resultDescription(data: AnalyticsDashboardData) {
  const breakdown = resultBreakdown(data.summary);
  if (breakdown.length) return breakdown.map(result => `${result.value.toLocaleString("pt-BR")} ${result.label.toLocaleLowerCase("pt-BR")}`).join("; ");
  return data.summary.primary_results === 0 ? "Nenhum resultado registrado" : "Resultado não confirmado pela Meta";
}
export function confirmedReportData(data: AnalyticsDashboardData): AnalyticsDashboardData {
  return { ...data,
    summary: aggregateResults(data.summary, data.coverage.status === "complete"),
    previousSummary: aggregateResults(data.previousSummary, data.coverage.previousStatus === "complete"),
    daily: data.daily.map(day => ({ ...day, values: aggregateResults(day.values, data.coverage.status === "complete") })),
    previousDaily: data.previousDaily.map(day => ({ ...day, values: aggregateResults(day.values, data.coverage.previousStatus === "complete") })),
  };
}
export function reportResultCosts(data: AnalyticsDashboardData, entityRows?: AnalyticsEntity[]) {
  return resultCostBreakdown(data.summary, entityRows?.length ? entityRows : data.campaigns);
}
export const reportDate = (date: string) => date.split("-").reverse().join("/");
export function reportUpdatedAt(data: AnalyticsDashboardData) {
  const date = [data.coverage.latestCollectedAt, data.metaAggregate?.collectedAt].filter((value): value is string => !!value)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return date ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(date)).replace(",", "") : "Ainda não atualizado";
}
export function estimatedMetric(data: AnalyticsDashboardData, key: string) {
  return (data.estimatedMetricKeys ?? (data.selectedAccountIds.length > 1
    ? ["reach", "frequency", "unique_clicks", "unique_inline_link_clicks", "unique_outbound_clicks", "unique_ctr", "unique_inline_link_click_ctr"] : [])).includes(key);
}
