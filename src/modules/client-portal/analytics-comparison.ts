import { resultTypes } from "./analytics-results";
import type { AnalyticsDashboardData, AnalyticsMetric } from "./analytics-types";

/**
 * Sentido desejável de uma métrica: "up" = subir é bom; "down" = subir é ruim (custos, CPM, CPC); "neutral" = nem bom nem
 * ruim (investimento e frequência). As regras por nome valem mesmo quando o dado guardado veio com outro sentido; fora delas vale o da própria métrica.
 */
export function desirableDirection(metric: Pick<AnalyticsMetric, "key" | "label" | "desirable">): "up" | "down" | "neutral" {
  const key = metric.key.toLowerCase();
  // Investimento e frequência não são bons nem ruins por si só: variação em cinza.
  if (["spend", "social_spend", "frequency"].includes(key)) return "neutral";
  if (/^(cost[:_]|cost$|cpc|cpp|cpm|cpa|cpl|cpv)/.test(key) || /(^|_)cost(_|$)/.test(key)) return "down";
  if (/^(custo|cpc|cpm|cpp)/i.test(metric.label.trim())) return "down";
  // Volume, entrega e retorno: subir é bom, mesmo que o dado guardado os tenha marcado como indiferentes.
  if (/^(impressions|reach|clicks|link_clicks|inline_link_clicks|outbound_clicks|unique_|primary_results|results?$|result:|action:|video_|inline_post_engagement|ctr|unique_ctr|roas|attributed_revenue|value:)/.test(key)) return "up";
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
