import { entityChildren, type AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import type { DeliveryGroup, DeliveryState } from "./delivery-state";

/**
 * `metricsPending`: as métricas históricas do período ainda NÃO estão confirmadas (coleta em andamento ou incompleta). A entidade vem do
 * catálogo lido na Meta e todos os seus valores estão indisponíveis; isso é diferente de "sem dado confirmado" e nunca é zero.
 */
export type CampaignRow = AnalyticsEntity & { state: DeliveryState; metricsPending?: boolean };
/** "restricted" reúne quem tem alguma condição que impede ou ameaça a entrega, qualquer que seja o estado. */
export type CampaignFilters = { query: string; group: DeliveryGroup | "restricted" | "all" };
export type SortSpec = { key: string; direction: "asc" | "desc" };

const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
const parentKeyOf = (row: AnalyticsEntity) => row.parentId ? `${row.level === "ad" ? "adset" : "campaign"}:${row.parentId}` : null;

/**
 * Mantém as linhas que atendem à busca e ao estado, mais seus ancestrais para a hierarquia continuar legível.
 * Uma busca que acerta a campanha ou o conjunto mantém também os filhos; o filtro de estado avalia cada nível.
 * Devolve também as chaves que devem abrir automaticamente para revelar os resultados.
 */
export function filterCampaignRows(rows: CampaignRow[], filters: CampaignFilters) {
  const query = fold(filters.query.trim());
  if (!query && filters.group === "all") return { rows, reveal: new Set<string>() };
  const byKey = new Map(rows.map(row => [`${row.accountId}:${row.key}`, row] as const));
  const parentOf = (row: CampaignRow) => { const key = parentKeyOf(row); return key ? byKey.get(`${row.accountId}:${key}`) ?? null : null; };
  const nameHit = (row: CampaignRow): boolean => !query || fold(row.name).includes(query) || (parentOf(row) ? nameHit(parentOf(row)!) : false);
  const kept = new Set<string>();
  const reveal = new Set<string>();
  for (const row of rows) {
    if (!nameHit(row) || (filters.group === "restricted" ? !row.state.restrictions.length : filters.group !== "all" && row.state.group !== filters.group)) continue;
    kept.add(`${row.accountId}:${row.key}`);
    for (let parent = parentOf(row); parent; parent = parentOf(parent)) {
      kept.add(`${parent.accountId}:${parent.key}`);
      reveal.add(parent.key);
    }
  }
  return { rows: rows.filter(row => kept.has(`${row.accountId}:${row.key}`)), reveal };
}

export function sortRows<T extends AnalyticsEntity>(list: T[], sort: SortSpec, valueOf: (row: T, key: string) => number | null | undefined = (row, key) => row.values[key]): T[] {
  const factor = sort.direction === "desc" ? -1 : 1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  return [...list].sort((a, b) => {
    if (sort.key === "name") return byName(a, b) * factor;
    const av = valueOf(a, sort.key), bv = valueOf(b, sort.key);
    if (av == null && bv == null) return byName(a, b);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av === bv ? byName(a, b) : (av - bv) * factor;
  });
}

export const childrenOf = (row: CampaignRow, rows: CampaignRow[]) => entityChildren(row, rows) as CampaignRow[];

/** Índice pai → filhos diretos (mesma regra de entityChildren: mesma conta, parentId e nível seguinte), construído uma vez por lista de linhas. */
export type ChildIndex = Map<string, CampaignRow[]>;
const parentLookupKey = (accountId: string, level: CampaignRow["level"], id: string) => `${accountId}|${level}|${id}`;
export function buildChildIndex(rows: CampaignRow[]): ChildIndex {
  const index: ChildIndex = new Map();
  for (const row of rows) {
    if (!row.parentId || row.level === "campaign") continue;
    const key = parentLookupKey(row.accountId, row.level === "ad" ? "adset" : "campaign", row.parentId);
    const list = index.get(key);
    if (list) list.push(row); else index.set(key, [row]);
  }
  return index;
}
export const indexedChildren = (row: CampaignRow, index: ChildIndex): CampaignRow[] => row.level === "ad" ? [] : index.get(parentLookupKey(row.accountId, row.level, row.id)) ?? [];
