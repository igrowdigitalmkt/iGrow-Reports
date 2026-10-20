import { formatAnalyticsValue } from "@/modules/client-portal/analytics-format";
import { resultBreakdown } from "@/modules/client-portal/analytics-results";
import { columnValue, resultState, rowKey, unavailableReason, type ColumnDef, type CostIndex } from "./columns";
import type { CampaignRow } from "./tree";

export const LEVEL_LABELS = { campaign: "Campanha", adset: "Conjunto de anúncios", ad: "Anúncio" } as const;
export const stamp = (iso: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(iso));

/** "visitas ao perfil" → "visita ao perfil": o subtítulo do custo diz "Por <tipo no singular>", como no Gerenciador de Anúncios. */
export function singularLabel(label: string): string {
  const words = label.split(" ");
  const single = (word: string) => /ões$/.test(word) ? word.replace(/ões$/, "ão") : /(ques)$/.test(word) ? word.replace(/ques$/, "que") : /^(?:[a-zà-ú]{4,})s$/.test(word) && !/(is|us)$/.test(word) ? word.slice(0, -1) : word;
  if (words.length) words[0] = single(words[0]!);
  const last = words.length - 1;
  if (last > 0 && /(das|dos|tas|tos)$/.test(words[last]!)) words[last] = words[last]!.slice(0, -1);
  return words.join(" ");
}

/** Resultados e custos por tipo ficam alinhados linha a linha; valor ausente mostra "—" e a explicação completa no title. */
export function Cell({ column, row, index }: { column: ColumnDef; row: CampaignRow; index: CostIndex }) {
  if (column.key === "results" || column.key === "cost_result") {
    const results = resultBreakdown(row.values);
    // Zero confirmado (a Meta informou resultados e nenhum ocorreu) aparece como 0; ausência e "não informado" continuam "—".
    if (!results.length) return resultState(row.values) === "zero" && column.key === "results"
      ? <span title={unavailableReason(row, column.key)}>{formatAnalyticsValue(0, column.metric, row.currency)}</span>
      : <span title={unavailableReason(row, column.key)}>—</span>;
    return <>{results.map(result => {
      const label = result.label.toLocaleLowerCase("pt-BR");
      const value = column.key === "results" ? result.value : index.get(rowKey(row))?.get(result.key) ?? null;
      const metric = column.metric;
      return <span className="campaigns-result" key={result.key} title={value == null ? unavailableReason(row, `cost:${result.key}`) : `${formatAnalyticsValue(value, metric, row.currency)} ${label}`}>
        {value == null ? "—" : formatAnalyticsValue(value, metric, row.currency)}<small>{column.key === "results" ? label : `Por ${singularLabel(label)}`}</small></span>;
    })}</>;
  }
  const value = columnValue(row, column.key, index);
  if (value == null) return <span title={unavailableReason(row, column.key)}>—</span>;
  return <>{formatAnalyticsValue(value, column.metric, row.currency)}</>;
}
