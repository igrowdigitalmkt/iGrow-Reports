import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { metaMetricLabel } from "@/modules/meta/metric-labels";

export function resultDescription(data: AnalyticsDashboardData) {
  if (data.primaryActionType) return metaMetricLabel(`action:${data.primaryActionType}`, data.primaryActionType.replaceAll("_", " "));
  return data.primaryMetricKey ? metaMetricLabel(data.primaryMetricKey, data.primaryMetricKey) : "Resultado principal ainda não definido";
}
export const reportDate = (date: string) => date.split("-").reverse().join("/");
export function reportUpdatedAt(data: AnalyticsDashboardData) {
  const date = data.coverage.latestCollectedAt;
  return date ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(date)).replace(",", "") : "Ainda não atualizado";
}
export function estimatedMetric(data: AnalyticsDashboardData, key: string) {
  return (data.estimatedMetricKeys ?? (data.selectedAccountIds.length > 1
    ? ["reach", "frequency", "unique_clicks", "unique_inline_link_clicks", "unique_outbound_clicks", "unique_ctr", "unique_inline_link_click_ctr"] : [])).includes(key);
}
