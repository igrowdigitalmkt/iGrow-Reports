import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeClientAnalytics } from "./analytics-calculations";
import { aggregateResults } from "./analytics-results";
import type { AnalyticsDashboardData, AnalyticsValues } from "./analytics-types";

const LONG_RANGE_CHUNK_DAYS = 180;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function splitRange(from: string, to: string) {
  const ranges: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const chunkTo = [shiftDate(cursor, LONG_RANGE_CHUNK_DAYS - 1), to].sort()[0];
    ranges.push({ from: cursor, to: chunkTo });
    cursor = shiftDate(chunkTo, 1);
  }
  return ranges;
}

function addValues(target: AnalyticsValues, source: AnalyticsValues) {
  for (const [key, value] of Object.entries(source)) {
    if (value == null || !Number.isFinite(value)) continue;
    target[key] = (target[key] ?? 0) + value;
  }
}

function finalizeValues(values: AnalyticsValues, complete: boolean) {
  const next = aggregateResults(values, complete);
  const spend = next.spend;
  const impressions = next.impressions;
  const linkClicks = next.link_clicks;
  const revenue = next.attributed_revenue ?? next["value:purchase"] ?? next["value:omni_purchase"];
  next.reach = null;
  next.frequency = null;
  next.unique_clicks = null;
  next.ctr_link = impressions && linkClicks != null ? linkClicks / impressions : null;
  next.cpc_link = linkClicks && spend != null ? spend / linkClicks : null;
  next.cpm = impressions && spend != null ? spend / impressions * 1000 : null;
  next.roas = spend && revenue != null ? revenue / spend : null;
  return next;
}

function coverageStatus(statuses: AnalyticsDashboardData["coverage"]["status"][]) {
  if (statuses.every(status => status === "complete")) return "complete";
  if (statuses.some(status => status !== "empty")) return "partial";
  return "empty";
}

function mergeRowsById<T extends { id: string; values: AnalyticsValues }>(rows: T[], complete: boolean): T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, { ...row, values: { ...row.values } });
    } else {
      addValues(current.values, row.values);
    }
  }
  return [...byId.values()].map(row => ({ ...row, values: finalizeValues(row.values, complete) }));
}

function mergeAnalytics(chunks: AnalyticsDashboardData[], dateFrom: string, dateTo: string): AnalyticsDashboardData {
  const summary: AnalyticsValues = {};
  for (const chunk of chunks) {
    addValues(summary, chunk.summary);
  }
  const status = coverageStatus(chunks.map(chunk => chunk.coverage.status));
  const totalDays = daysBetween(dateFrom, dateTo);
  const previousDateTo = shiftDate(dateFrom, -1);
  const previousDateFrom = shiftDate(dateFrom, -totalDays);
  const metrics = new Map(chunks.flatMap(chunk => chunk.metrics.map(metric => [metric.key, metric] as const)));
  const latestCollectedAt = chunks.map(chunk => chunk.coverage.latestCollectedAt).filter((value): value is string => !!value).sort().at(-1) ?? null;
  const warnings = new Set(chunks.flatMap(chunk => chunk.warnings));
  warnings.add("Período anual carregado em blocos para evitar uma consulta longa. Alcance, frequência e cliques únicos aparecem somente quando houver agregado exato da Meta.");
  warnings.add("A comparação anterior fica indisponível na visualização anual em blocos. Use Atualizar dados ou um período menor para comparar variações.");
  return {
    ...chunks[0],
    dateFrom, dateTo, previousDateFrom, previousDateTo,
    summary: finalizeValues(summary, status === "complete"),
    previousSummary: {},
    daily: chunks.flatMap(chunk => chunk.daily).sort((a, b) => a.date.localeCompare(b.date)),
    previousDaily: [],
    accountTotals: mergeRowsById(chunks.flatMap(chunk => chunk.accountTotals), status === "complete"),
    campaigns: mergeRowsById(chunks.flatMap(chunk => chunk.campaigns), status === "complete"),
    metrics: [...metrics.values()],
    coverage: {
      status, previousStatus: "empty", latestCollectedAt,
      coveredDays: chunks.reduce((sum, chunk) => sum + chunk.coverage.coveredDays, 0),
      previousCoveredDays: 0,
      totalDays,
    },
    warnings: [...warnings],
    estimatedMetricKeys: [...new Set(chunks.flatMap(chunk => chunk.estimatedMetricKeys ?? []))],
  };
}

async function getClientAnalyticsDirect(
  supabase: SupabaseClient<Database>,
  clientId: string,
  dateFrom: string,
  dateTo: string,
  accountIds?: string[] | null,
) {
  const { data, error } = await supabase.rpc("get_client_analytics", {
    p_client_id: clientId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_ad_account_ids: accountIds?.length ? accountIds : undefined,
  });

  if (error || !data) {
    throw new Error("Não foi possível consultar o desempenho deste cliente. Confira o período e tente novamente.");
  }
  return normalizeClientAnalytics(data);
}

export async function getClientAnalytics(
  supabase: SupabaseClient<Database>,
  clientId: string,
  dateFrom: string,
  dateTo: string,
  accountIds?: string[] | null,
): Promise<AnalyticsDashboardData> {
  try {
    return await getClientAnalyticsDirect(supabase, clientId, dateFrom, dateTo, accountIds);
  } catch (error) {
    if (daysBetween(dateFrom, dateTo) <= LONG_RANGE_CHUNK_DAYS) throw error;
  }
  const chunks = [];
  for (const range of splitRange(dateFrom, dateTo)) {
    chunks.push(await getClientAnalyticsDirect(supabase, clientId, range.from, range.to, accountIds));
  }
  return mergeAnalytics(chunks, dateFrom, dateTo);
}
