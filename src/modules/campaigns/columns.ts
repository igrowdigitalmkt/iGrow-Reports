import { resultBreakdown, resultCostBreakdown, resultFamilyValue, resultTypes } from "@/modules/client-portal/analytics-results";
import type { AnalyticsMetric, AnalyticsValues } from "@/modules/client-portal/analytics-types";
import type { CampaignRow } from "./tree";

export type ColumnDef = { key: string; label: string; group: "base" | "results"; metric: AnalyticsMetric; sortable: boolean; hint?: string };

const metric = (key: string, label: string, unit: AnalyticsMetric["unit"]): AnalyticsMetric => ({ key, label, unit, precision: unit === "currency" ? 2 : 0, desirable: unit === "currency" ? "down" : "up" });

/** Métricas base mostradas quando a coleta da conta as trouxe (resultados e custos têm tratamento próprio abaixo). */
export const BASE_METRIC_KEYS = ["spend", "reach", "impressions", "link_clicks", "ctr_link", "cpc_link", "cpm"];
/**
 * Definição das métricas base para quando a coleta do período ainda não as trouxe: as colunas existem (com "—"), nunca com valores.
 * Rótulos e unidades iguais aos da coleta.
 */
export const FALLBACK_BASE_METRICS: AnalyticsMetric[] = [
  { key: "spend", label: "Investimento", unit: "currency", precision: 2, desirable: "neutral" },
  { key: "reach", label: "Alcance", unit: "integer", precision: 0, desirable: "up" },
  { key: "impressions", label: "Impressões", unit: "integer", precision: 0, desirable: "up" },
  { key: "link_clicks", label: "Cliques no link", unit: "integer", precision: 0, desirable: "up" },
  { key: "ctr_link", label: "CTR (link)", unit: "percent", precision: 2, desirable: "up" },
  { key: "cpc_link", label: "CPC (link)", unit: "currency", precision: 2, desirable: "down" },
  { key: "cpm", label: "CPM", unit: "currency", precision: 2, desirable: "down" },
];
export const PENDING_METRICS_REASON = "As métricas deste período ainda estão sendo atualizadas. Por enquanto este valor está indisponível (não é zero).";

/** Colunas padrão, nesta ordem: Valor usado, Resultados, Custo por resultado, Alcance e Impressões. */
export const DEFAULT_COLUMN_KEYS = ["spend", "results", "cost_result", "reach", "impressions"];

export const ATTRIBUTED_HINT = "Custo atribuído: investimento da entidade (ou dos seus conjuntos/anúncios que têm um único tipo de resultado) ÷ resultados desse tipo. Só aparece quando a soma confere com os totais confirmados.";
export const EVENT_HINT = "Referência: investimento total da entidade ÷ volume deste evento. Não é custo atribuído: com mais de um tipo de resultado o investimento é compartilhado.";

/** Tipos de resultado (leads, mensagens, compras...) com valor no período, em ordem alfabética, sem escolher um principal. */
export function resultFamilies(rows: Pick<CampaignRow, "values">[]) {
  const families = new Map<string, string>();
  for (const row of rows) for (const result of resultBreakdown(row.values)) families.set(result.key, result.label);
  return [...families].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

export function buildColumns(metrics: AnalyticsMetric[], families: { key: string; label: string }[]): ColumnDef[] {
  const base: ColumnDef[] = BASE_METRIC_KEYS.flatMap(key => metrics.filter(item => item.key === key)).map(item => ({ key: item.key, label: item.label, group: "base", metric: item, sortable: true }));
  return [
    ...base.filter(column => column.key === "spend"),
    { key: "results", label: "Resultados", group: "results", metric: metric("results", "Resultados", "integer"), sortable: true, hint: "Cada tipo de resultado aparece separado; nada é somado. A ordenação usa o tipo de maior volume." },
    { key: "cost_result", label: "Custo por resultado", group: "results", metric: metric("cost_result", "Custo por resultado", "currency"), sortable: true, hint: `${ATTRIBUTED_HINT} A ordenação usa o custo do tipo de resultado de maior volume.` },
    ...base.filter(column => column.key !== "spend"),
    ...families.flatMap(family => [
      { key: `result:${family.key}`, label: `Resultados: ${family.label}`, group: "results" as const, metric: metric(`result:${family.key}`, `Resultados: ${family.label}`, "integer"), sortable: true },
      { key: `cost:${family.key}`, label: `Custo atribuído: ${family.label}`, group: "results" as const, metric: metric(`cost:${family.key}`, `Custo atribuído: ${family.label}`, "currency"), sortable: true, hint: ATTRIBUTED_HINT },
      { key: `event:${family.key}`, label: `Investimento ÷ ${family.label}`, group: "results" as const, metric: metric(`event:${family.key}`, `Investimento ÷ ${family.label}`, "currency"), sortable: true, hint: EVENT_HINT },
    ]),
  ];
}

const hasData = (values: AnalyticsValues) => Object.keys(values).length > 0;

/**
 * Situação dos resultados de uma entidade, conforme o contrato de coleta (result-values.ts):
 * - "none": sem linha confirmada (ausência de dados, não é zero);
 * - "unknown": linha confirmada, mas a Meta não informou resultados (result:provider_known diferente de 1);
 * - "zero": a Meta informou resultados e nenhum tipo teve valor (zero confirmado);
 * - "some": há ao menos um tipo com valor.
 */
export function resultState(values: AnalyticsValues): "none" | "unknown" | "zero" | "some" {
  if (!hasData(values)) return "none";
  if (values["result:provider_known"] !== 1) return "unknown";
  return resultBreakdown(values).length ? "some" : "zero";
}
export const rowKey = (row: Pick<CampaignRow, "accountId" | "key">) => `${row.accountId}:${row.key}`;
export type CostIndex = Map<string, Map<string, number>>;

/**
 * Custo ATRIBUÍDO por tipo de resultado, para cada linha, reutilizando resultCostBreakdown (a mesma regra dos relatórios):
 * - um único tipo na própria linha: investimento ÷ resultados da linha;
 * - mais de um tipo: só a partir dos filhos diretos que têm um único tipo, e apenas quando a soma de investimento e de
 *   resultados dos filhos confere com a linha. Filhos sem dado confirmado não entram; se faltarem dados a conferência falha.
 * Tipos sem atribuição confiável não entram no mapa.
 */
export function buildCostIndex(rows: CampaignRow[]): CostIndex {
  const children = new Map<string, CampaignRow[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const parent = `${row.accountId}:${row.level === "ad" ? "adset" : "campaign"}:${row.parentId}`;
    children.set(parent, [...(children.get(parent) ?? []), row]);
  }
  const index: CostIndex = new Map();
  for (const row of rows) {
    if (!hasData(row.values)) continue;
    const single = resultTypes(row.values).length <= 1;
    const known = (children.get(rowKey(row)) ?? []).filter(child => hasData(child.values));
    const sources = single ? [row] : known;
    if (!sources.length) continue;
    const costs = new Map<string, number>();
    for (const item of resultCostBreakdown(row.values, sources.map(source => ({ values: source.values, level: source.level, id: source.id, accountId: source.accountId, parentId: source.parentId, campaignId: source.campaignId })))) {
      if (item.cost != null) costs.set(item.key, item.cost);
    }
    index.set(rowKey(row), costs);
  }
  return index;
}

/** Investimento total ÷ volume do evento: referência, não atribuição. */
export function eventCost(values: AnalyticsValues, family: string): number | null {
  const volume = resultFamilyValue(values, family);
  const spend = values.spend;
  return volume != null && volume > 0 && spend != null && Number.isFinite(spend) && spend >= 0 ? spend / volume : null;
}

export function columnValue(row: CampaignRow, key: string, index: CostIndex): number | null {
  if (key.startsWith("cost:")) return index.get(rowKey(row))?.get(key.slice(5)) ?? null;
  if (key.startsWith("event:")) return eventCost(row.values, key.slice(6));
  if (key.startsWith("result:")) return resultFamilyValue(row.values, key.slice(7));
  return row.values[key] ?? null;
}

/**
 * Valor usado SÓ para ordenar. Resultados e custo por resultado mostram cada tipo separado (nada é somado); para ordenar, vale o tipo
 * de maior volume da própria linha e o custo atribuído a esse mesmo tipo.
 */
export function sortValue(row: CampaignRow, key: string, index: CostIndex): number | null {
  if (key === "results" || key === "cost_result") {
    const top = [...resultBreakdown(row.values)].sort((a, b) => b.value - a.value)[0];
    if (!top) return null;
    return key === "results" ? top.value : index.get(rowKey(row))?.get(top.key) ?? null;
  }
  return columnValue(row, key, index);
}

/** Prioridade da ordem padrão (como no Gerenciador de Anúncios): 0 = em veiculação, 1 = ativa, 2 = demais. */
export function deliveryTier(state: CampaignRow["state"]): 0 | 1 | 2 {
  if (state.group === "active" && state.restrictions.length === 0) return 0;
  if (state.group === "active" || state.configured?.code === "ACTIVE") return 1;
  return 2;
}

/**
 * Chave numérica da ordem padrão, crescente: 1º campanhas em veiculação, 2º ativas, 3º data de criação (mais recentes primeiro).
 * Sem data de criação a entidade fica no fim do seu grupo (a ordem seguinte é pelo nome).
 */
export function priorityValue(state: CampaignRow["state"]): number {
  const created = state.createdAt ? Date.parse(state.createdAt) : NaN;
  return deliveryTier(state) * 1e15 - (Number.isFinite(created) ? created : 0);
}

/** Por que um valor não é mostrado: ausência de dados é diferente de métrica sem denominador ou sem atribuição segura. */
export function unavailableReason(row: CampaignRow, key: string): string {
  if (row.metricsPending) return PENDING_METRICS_REASON;
  if (!hasData(row.values)) return "Sem dado confirmado para esta entidade no período (não é o mesmo que zero).";
  if (key === "results" || key === "cost_result") {
    const state = resultState(row.values);
    if (state === "unknown") return "A Meta não informou resultados para esta entidade no período (não é o mesmo que zero).";
    if (state === "zero") return key === "results" ? "Zero confirmado: a Meta informou resultados e nenhum foi registrado no período." : "Sem resultados no período: o custo por resultado não se aplica.";
  }
  if (key.startsWith("cost:") || key === "cost_result") {
    return resultTypes(row.values).length > 1
      ? "O investimento é compartilhado entre mais de um tipo de resultado e o detalhamento confirmado dos conjuntos ou anúncios não permite atribuí-lo com segurança. Use “Investimento ÷ tipo” como referência."
      : "Sem resultados deste tipo ou sem investimento confirmado para calcular o custo.";
  }
  if (key.startsWith("event:")) return "Sem volume deste evento ou sem investimento confirmado para calcular a referência.";
  return "Métrica indisponível para esta entidade no período (por exemplo, sem denominador).";
}
