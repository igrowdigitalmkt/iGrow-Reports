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

const ADDITIVE_FIELDS = new Set([
  "spend", "impressions", "link_clicks", "clicks", "inline_post_engagement", "outbound_clicks",
  "instagram_profile_visits", "social_spend", "attributed_revenue", "video_plays", "video_p25",
  "video_p50", "video_p75", "video_p95", "video_p100",
]);

// Ratios and distinct people cannot be added across dates. Unknown chunks
// remain unknown instead of silently publishing only their available portion.
export function mergeAnalyticsValues(sources: AnalyticsValues[], complete: boolean): AnalyticsValues {
  const values: AnalyticsValues = {};
  const nativeResults = sources.length > 0 && sources.every(source => source["result:provider_known"] === 1);
  const keys = new Set(sources.flatMap(source => Object.keys(source)));
  for (const key of keys) {
    if (!ADDITIVE_FIELDS.has(key) && !key.startsWith("action:") && !key.startsWith("value:")
      && !key.startsWith("result:provider:")) continue;
    const amounts = sources.map(source => Object.hasOwn(source, key) ? source[key]
      : nativeResults && key.startsWith("result:provider:") ? 0 : null);
    values[key] = amounts.every((amount): amount is number => amount != null && Number.isFinite(amount))
      ? amounts.reduce((sum, amount) => sum + amount, 0) : null;
  }
  if (nativeResults) values["result:provider_known"] = 1;
  return finalizeValues(values, complete);
}

function finalizeValues(values: AnalyticsValues, complete: boolean) {
  const next = aggregateResults(values, complete);
  const spend = next.spend;
  const impressions = next.impressions;
  const linkClicks = next.link_clicks;
  const revenue = next.attributed_revenue ?? next["value:action:omni_purchase"] ?? next["value:action:purchase"];
  for (const key of ["reach", "frequency", "unique_clicks", "unique_inline_link_clicks", "unique_outbound_clicks",
    "unique_ctr", "unique_inline_link_click_ctr", "unique_outbound_clicks_ctr", "cpp"]) next[key] = null;
  next.ctr_link = impressions && linkClicks != null ? linkClicks / impressions * 100 : null;
  next.cpc_link = linkClicks && spend != null ? spend / linkClicks : null;
  next.cpm = impressions && spend != null ? spend / impressions * 1000 : null;
  next.roas = spend && revenue != null ? revenue / spend : null;
  next.ctr = impressions && next.clicks != null ? next.clicks / impressions * 100 : null;
  next.cpc = next.clicks && spend != null ? spend / next.clicks : null;
  next.outbound_clicks_ctr = impressions && next.outbound_clicks != null ? next.outbound_clicks / impressions * 100 : null;
  for (const [key, amount] of Object.entries(next)) if (key.startsWith("action:")) {
    next[`cost:${key}`] = amount && spend != null ? spend / amount : null;
  }
  return next;
}

function coverageStatus(statuses: AnalyticsDashboardData["coverage"]["status"][]) {
  if (statuses.every(status => status === "complete")) return "complete";
  if (statuses.some(status => status !== "empty")) return "partial";
  return "empty";
}

function mergeRowsById<T extends { id: string; values: AnalyticsValues }>(rows: T[], complete: boolean): T[] {
  const byId = new Map<string, { row: T; sources: AnalyticsValues[] }>();
  for (const row of rows) {
    const key = `${"accountId" in row ? row.accountId : row.id}:${row.id}`;
    const current = byId.get(key);
    if (!current) {
      byId.set(key, { row, sources: [row.values] });
    } else {
      current.sources.push(row.values);
    }
  }
  return [...byId.values()].map(({ row, sources }) => ({ ...row, values: mergeAnalyticsValues(sources, complete) }));
}

function mergeAnalytics(chunks: AnalyticsDashboardData[], dateFrom: string, dateTo: string): AnalyticsDashboardData {
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
    metaAggregate: { confirmed: false, collectedAt: null, version: null },
    dateFrom, dateTo, previousDateFrom, previousDateTo,
    summary: mergeAnalyticsValues(chunks.map(chunk => chunk.summary), status === "complete"),
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
    if (error) console.error("client-analytics-rpc", {
      code: error.code, message: error.message, details: error.details, hint: error.hint,
      clientId, dateFrom, dateTo, accountCount: accountIds?.length ?? null,
    });
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
