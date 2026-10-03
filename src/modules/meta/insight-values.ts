import Decimal from "decimal.js";
import type { AnalyticsValues } from "@/modules/client-portal/analytics-types";
import { aggregateResults } from "@/modules/client-portal/analytics-results";
import type { MetaInsight } from "./client";
import { providerResultValues } from "./result-values";

export const META_MESSAGE_ACTION = "onsite_conversion.messaging_conversation_started_7d";

export function hasOverlappingMetaSelection(ads: Array<{ id: string; campaign_id?: string; adset_id?: string }>, entityKeys: string[]) {
  const keys = new Set(entityKeys);
  return ads.some(ad => keys.has(`campaign:${ad.campaign_id}`) && (keys.has(`adset:${ad.adset_id}`) || keys.has(`ad:${ad.id}`))
    || keys.has(`adset:${ad.adset_id}`) && keys.has(`ad:${ad.id}`));
}

export function selectedPeriodInsightRows(levels: Array<{ level: "campaign" | "adset" | "ad"; rows: MetaInsight[] }>, entityKeys: string[]) {
  const keys = new Set(entityKeys);
  return levels.flatMap(({ level, rows }) => rows.filter(row => keys.has(`${level}:${row[`${level}_id`]}`)));
}

const SCALARS = {
  spend: "spend", impressions: "impressions", reach: "reach", frequency: "frequency",
  clicks: "clicks", unique_clicks: "unique_clicks", inline_link_clicks: "link_clicks",
  inline_post_engagement: "inline_post_engagement", unique_inline_link_clicks: "unique_inline_link_clicks",
  social_spend: "social_spend", instagram_profile_visits: "instagram_profile_visits",
} as const;
const ARRAYS = {
  outbound_clicks: ["outbound_clicks", "outbound_click"],
  unique_outbound_clicks: ["unique_outbound_clicks", "outbound_click"],
  video_play_actions: ["video_plays", "video_view"],
  video_p25_watched_actions: ["video_p25", "video_view"],
  video_p50_watched_actions: ["video_p50", "video_view"],
  video_p75_watched_actions: ["video_p75", "video_view"],
  video_p95_watched_actions: ["video_p95", "video_view"],
  video_p100_watched_actions: ["video_p100", "video_view"],
} as const;

function number(value: unknown): number | null {
  if (value == null) return null;
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && !value.trim())) {
    throw new Error("Métrica Meta inválida.");
  }
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error("Métrica Meta inválida.");
  return parsed.toNumber();
}

function actionValues(input: unknown, additive = true): Map<string, number> | null {
  if (!Array.isArray(input)) return null;
  const values = new Map<string, number>();
  for (const entry of input) {
    if (!entry || typeof entry !== "object" || typeof entry.action_type !== "string" || !entry.action_type.trim()) {
      throw new Error("Ação Meta inválida.");
    }
    const amount = number(entry.value);
    if (amount === null) throw new Error("Ação Meta sem valor confirmado.");
    if (!additive && values.has(entry.action_type)) throw new Error("Custo Meta duplicado para a mesma ação.");
    values.set(entry.action_type, new Decimal(values.get(entry.action_type) ?? 0).add(amount).toNumber());
  }
  return values;
}

const ratio = (numerator: number | null | undefined, denominator: number | null | undefined, factor = 1) =>
  numerator != null && denominator != null && denominator > 0 ? numerator / denominator * factor : null;

export function applyProviderResults(values: AnalyticsValues, provider: AnalyticsValues | null): AnalyticsValues {
  const next = Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith("result:")));
  next["result:provider_known"] = provider ? 1 : 0;
  if (provider) Object.assign(next, provider);
  return aggregateResults(next, true);
}

export function insightActionTypes(rows: MetaInsight[]): string[] {
  const types = new Set([META_MESSAGE_ACTION]);
  for (const row of rows) for (const field of ["actions", "action_values", "cost_per_action_type"] as const) {
    const values = actionValues(row[field], field !== "cost_per_action_type");
    for (const key of values?.keys() ?? []) types.add(key);
  }
  return [...types].sort();
}

// A successful empty request proves zero delivery. An omitted field on a
// nonempty provider row remains unknown; it must not inherit historical data.
export function periodInsightValues(row: MetaInsight | undefined, options: {
  confirmedEmpty?: boolean;
  actionTypes?: string[];
  moneyCompatible?: boolean;
} = {}): AnalyticsValues {
  const confirmedEmpty = !row && options.confirmedEmpty === true;
  const noDelivery = confirmedEmpty || (number(row?.spend) === 0 && number(row?.impressions) === 0);
  const moneyCompatible = options.moneyCompatible !== false;
  const values: AnalyticsValues = {};
  for (const [field, key] of Object.entries(SCALARS)) {
    values[key] = number(row?.[field]) ?? (noDelivery ? 0 : null);
  }
  for (const [field, [key, type]] of Object.entries(ARRAYS)) {
    const list = actionValues(row?.[field]);
    values[key] = list ? list.get(type) ?? 0 : noDelivery ? 0 : null;
  }
  if (!moneyCompatible) values.spend = values.social_spend = null;
  const actions = actionValues(row?.actions);
  const revenues = actionValues(row?.action_values);
  const costs = actionValues(row?.cost_per_action_type, false);
  const types = new Set([META_MESSAGE_ACTION, ...(options.actionTypes ?? []), ...actions?.keys() ?? [], ...revenues?.keys() ?? [], ...costs?.keys() ?? []]);
  for (const type of types) {
    const key = `action:${type}`;
    values[key] = actions ? actions.get(type) ?? 0 : confirmedEmpty ? 0 : null;
    values[`value:${key}`] = moneyCompatible && revenues ? revenues.get(type) ?? 0 : confirmedEmpty && moneyCompatible ? 0 : null;
    values[`cost:${key}`] = moneyCompatible && values[key] != null && values[key]! > 0
      ? costs?.get(type) ?? ratio(values.spend, values[key]) : null;
  }
  const scalarRatio = (field: string, numerator: string, denominator: string, factor = 1) =>
    number(row?.[field]) ?? ratio(values[numerator], values[denominator], factor);
  values.ctr_link = scalarRatio("inline_link_click_ctr", "link_clicks", "impressions", 100);
  values.cpc_link = moneyCompatible ? scalarRatio("cost_per_inline_link_click", "spend", "link_clicks") : null;
  values.ctr = scalarRatio("ctr", "clicks", "impressions", 100);
  values.cpc = moneyCompatible ? scalarRatio("cpc", "spend", "clicks") : null;
  values.cpm = moneyCompatible ? scalarRatio("cpm", "spend", "impressions", 1000) : null;
  values.cpp = moneyCompatible ? scalarRatio("cpp", "spend", "reach", 1000) : null;
  values.unique_ctr = scalarRatio("unique_ctr", "unique_clicks", "reach", 100);
  values.unique_inline_link_click_ctr = scalarRatio("unique_inline_link_click_ctr", "unique_inline_link_clicks", "reach", 100);
  const outboundCtr = actionValues(row?.outbound_clicks_ctr);
  const uniqueOutboundCtr = actionValues(row?.unique_outbound_clicks_ctr);
  values.outbound_clicks_ctr = outboundCtr?.get("outbound_click") ?? ratio(values.outbound_clicks, values.impressions, 100);
  values.unique_outbound_clicks_ctr = uniqueOutboundCtr?.get("outbound_click") ?? ratio(values.unique_outbound_clicks, values.reach, 100);
  // Purchase aliases describe alternative totals and are never added together.
  const purchaseType = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"].find(type => revenues?.has(type));
  values.attributed_revenue = moneyCompatible && purchaseType ? revenues!.get(purchaseType)! : confirmedEmpty && moneyCompatible ? 0 : null;
  values.roas = ratio(values.attributed_revenue, values.spend);
  return applyProviderResults(values, confirmedEmpty ? { "result:provider_known": 1 } : row ? providerResultValues(row) : null);
}

export function confirmedEmptyPeriodValues(actionTypes: string[] = []): AnalyticsValues {
  return periodInsightValues(undefined, { confirmedEmpty: true, actionTypes });
}

const ADDITIVE = new Set([...Object.values(SCALARS).filter(key => key !== "frequency"), ...Object.values(ARRAYS).map(([key]) => key), "attributed_revenue"]);

export function sumPeriodInsightValues(rows: AnalyticsValues[], moneyCompatible = true): AnalyticsValues {
  if (rows.length === 1 && moneyCompatible) return { ...rows[0] };
  const keys = new Set([...ADDITIVE, ...rows.flatMap(row => Object.keys(row))]);
  const values: AnalyticsValues = {};
  for (const key of keys) {
    if (!ADDITIVE.has(key) && !key.startsWith("action:") && !key.startsWith("value:action:")) continue;
    const amounts = rows.map(row => row[key]);
    values[key] = rows.length && amounts.every(amount => amount != null)
      ? amounts.reduce<number>((sum, amount) => new Decimal(sum).add(amount!).toNumber(), 0) : null;
  }
  if (!moneyCompatible) for (const key of Object.keys(values)) {
    if (["spend", "social_spend", "attributed_revenue"].includes(key) || key.startsWith("value:")) values[key] = null;
  }
  values.frequency = ratio(values.impressions, values.reach);
  for (const [key, numerator, denominator, factor] of [
    ["ctr_link", "link_clicks", "impressions", 100], ["ctr", "clicks", "impressions", 100],
    ["unique_ctr", "unique_clicks", "reach", 100], ["unique_inline_link_click_ctr", "unique_inline_link_clicks", "reach", 100],
    ["outbound_clicks_ctr", "outbound_clicks", "impressions", 100], ["unique_outbound_clicks_ctr", "unique_outbound_clicks", "reach", 100],
    ["cpc_link", "spend", "link_clicks", 1], ["cpc", "spend", "clicks", 1],
    ["cpm", "spend", "impressions", 1000], ["cpp", "spend", "reach", 1000], ["roas", "attributed_revenue", "spend", 1],
  ] as const) values[key] = ratio(values[numerator], values[denominator], factor);
  for (const key of keys) if (key.startsWith("action:")) values[`cost:${key}`] = ratio(values.spend, values[key]);
  let provider: AnalyticsValues | null = null;
  if (rows.length && rows.every(row => row["result:provider_known"] === 1)) {
    provider = { "result:provider_known": 1 };
    for (const row of rows) for (const [key, amount] of Object.entries(row)) {
      if (key.startsWith("result:provider:")) provider[key] = (provider[key] ?? 0) + (amount ?? 0);
    }
  }
  return applyProviderResults(values, provider);
}
