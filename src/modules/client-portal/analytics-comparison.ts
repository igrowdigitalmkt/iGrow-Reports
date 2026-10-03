import { resultTypes } from "./analytics-results";
import type { AnalyticsDashboardData, AnalyticsMetric } from "./analytics-types";

export function changeDescription(data: AnalyticsDashboardData, metric: AnalyticsMetric) {
  if (data.coverage.status !== "complete" || data.coverage.previousStatus !== "complete") {
    return { text: "Comparação sem cobertura completa", direction: "neutral" };
  }
  if (["primary_results", "cost_per_result"].includes(metric.key)) {
    const currentTypes = resultTypes(data.summary), previousTypes = resultTypes(data.previousSummary);
    if (currentTypes.length > 1 || previousTypes.length > 1
      || (currentTypes.length > 0 && previousTypes.length > 0 && currentTypes.join(",") !== previousTypes.join(","))) {
      return { text: "Resultados com tipos diferentes", direction: "neutral" };
    }
  }
  const current = data.summary[metric.key], previous = data.previousSummary[metric.key];
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { text: "Comparação indisponível", direction: "neutral" };
  }
  if (previous === 0) return { text: current === 0 ? "Sem variação no período" : "Anterior igual a zero", direction: "neutral" };
  const change = (current - previous) / Math.abs(previous) * 100;
  if (Math.abs(change) < .05) return { text: "Sem variação no período", direction: "neutral" };
  return {
    text: `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. anterior`,
    direction: change > 0 ? "positive" : "negative", up: change > 0,
  };
}
