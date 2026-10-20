import { resultTypes } from "./analytics-results";
import type { AnalyticsDashboardData, AnalyticsMetric } from "./analytics-types";

/**
 * Sentido desejável de uma métrica: "up" = subir é bom; "down" = subir é ruim (custos, CPM, CPC, frequência); "neutral" = nem bom nem
 * ruim (investimento). As regras por nome valem mesmo quando o dado guardado veio com outro sentido; fora delas vale o da própria métrica.
 */
export function desirableDirection(metric: Pick<AnalyticsMetric, "key" | "label" | "desirable">): "up" | "down" | "neutral" {
  const key = metric.key.toLowerCase();
  if (["spend", "social_spend"].includes(key)) return "neutral";
  if (/^(cost[:_]|cost$|cpc|cpp|cpm|cpa|cpl|cpv|frequency)/.test(key) || /(^|_)cost(_|$)/.test(key)) return "down";
  if (/^(custo|cpc|cpm|cpp|frequência)/i.test(metric.label.trim())) return "down";
  return metric.desirable;
}

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
  // A seta mostra para onde o número foi; a cor diz se isso é bom (verde), ruim (vermelho) ou indiferente (cinza) para ESTA métrica.
  const desirable = desirableDirection(metric);
  return {
    text: `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. anterior`,
    direction: desirable === "neutral" ? "neutral" : (change > 0) === (desirable === "up") ? "positive" : "negative", up: change > 0,
  };
}
