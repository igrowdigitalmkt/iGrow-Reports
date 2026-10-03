import type { AnalyticsValues } from "./analytics-types";
import { metaMetricLabel } from "@/modules/meta/metric-labels";

// Use one provider aggregate per outcome family, never add its aliases.
export const RESULT_GROUPS = [
  { key: "messages", label: "Conversas por mensagem iniciadas", fields: ["action:onsite_conversion.messaging_conversation_started_7d"] },
  { key: "profile_visits", label: "Visitas ao perfil do Instagram", fields: ["instagram_profile_visits", "action:instagram_profile_visit", "action:onsite_conversion.instagram_profile_visit"] },
  { key: "leads", label: "Leads", fields: ["action:lead", "action:omni_lead", "action:onsite_conversion.lead_grouped", "action:offsite_conversion.fb_pixel_lead"] },
  { key: "registrations", label: "Cadastros concluídos", fields: ["action:omni_complete_registration", "action:complete_registration", "action:offsite_conversion.fb_pixel_complete_registration"] },
  { key: "purchases", label: "Compras", fields: ["action:omni_purchase", "action:purchase", "action:offsite_conversion.fb_pixel_purchase"] },
] as const;

export function aggregateResults(values: AnalyticsValues, complete: boolean): AnalyticsValues {
  const next = { ...values };
  // Secondary conversion families remain useful detail, but do not identify
  // the outcome chosen by Meta for the campaign's optimization goal.
  for (const group of RESULT_GROUPS) {
    const existing = values[`result:${group.key}`];
    const amount = existing ?? group.fields.map(key => values[key]).find(value => value != null);
    next[`result:${group.key}`] = amount ?? null;
  }
  const results = providerResultEntries(values);
  const total = results?.reduce((sum, result) => sum + result.value, 0) ?? null;
  next.primary_results = complete && results != null && results.length <= 1 ? total : null;
  // Different optimization outcomes have different denominators. A single
  // blended cost would imply that those outcomes were interchangeable.
  next.cost_per_result = complete && results?.length === 1 && total != null && total > 0
    && values.spend != null && Number.isFinite(values.spend) && values.spend >= 0
    ? values.spend / total : null;
  return next;
}

function resultFamilyKey(key: string) {
  if (RESULT_GROUPS.some(group => group.key === key)) return key;
  const providerKey = key.startsWith("result:provider:") ? key.slice("result:provider:".length) : key;
  if (providerKey === "profile_visit_view") return "profile_visits";
  const group = RESULT_GROUPS.find(item => item.fields.some(field => field === providerKey));
  return group?.key ?? key;
}

function resultFamilyLabel(key: string) {
  const group = RESULT_GROUPS.find(item => item.key === key);
  if (group) return group.label;
  const providerKey = key.startsWith("result:provider:") ? key.slice("result:provider:".length) : key;
  return metaMetricLabel(providerKey, providerKey);
}

function providerResultEntries(values: AnalyticsValues) {
  if (values["result:provider_known"] !== 1) return null;
  const totals = new Map<string, number>();
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith("result:provider:")) continue;
    if (value == null || !Number.isFinite(value) || value < 0) return null;
    const familyKey = resultFamilyKey(key);
    totals.set(familyKey, (totals.get(familyKey) ?? 0) + value);
  }
  return [...totals].map(([key, value]) => ({ key, label: resultFamilyLabel(key), value }));
}

export function resultBreakdown(values: AnalyticsValues) {
  return providerResultEntries(values)?.filter(result => result.value > 0) ?? [];
}

export function resultTypes(values: AnalyticsValues) {
  return providerResultEntries(values)?.map(result => result.key).sort() ?? [];
}

type ResultSource = {
  values: AnalyticsValues;
  level?: "campaign" | "adset" | "ad";
  id?: string; accountId?: string; parentId?: string | null; campaignId?: string | null;
};

// Saved reports can contain a parent and all its descendants. Use the same
// disjoint entity scope as the dashboard rather than double-counting spend.
export function disjointResultSources<T extends ResultSource>(sources: T[]): T[] {
  const campaigns = new Set(sources.filter(source => source.level === "campaign")
    .map(source => `${source.accountId}:${source.id}`));
  const adsets = new Set(sources.filter(source => source.level === "adset")
    .map(source => `${source.accountId}:${source.id}`));
  return sources.filter(source => {
    if (source.level !== "campaign" && source.campaignId && campaigns.has(`${source.accountId}:${source.campaignId}`)) return false;
    return source.level !== "ad" || !source.parentId || !adsets.has(`${source.accountId}:${source.parentId}`);
  });
}

export function resultCostBreakdown(summary: AnalyticsValues, sources: ResultSource[]) {
  const totals = new Map<string, { spend: number; results: number }>();
  let complete = sources.length > 0 && summary.spend != null && Number.isFinite(summary.spend) && summary.spend >= 0;
  let sourceSpend = 0;
  for (const source of disjointResultSources(sources)) {
    const spend = source.values.spend;
    if (spend == null || !Number.isFinite(spend) || spend < 0) { complete = false; continue; }
    sourceSpend += spend;
    const results = providerResultEntries(source.values);
    if (!results || results.length !== 1) {
      // A confirmed zero-spend source cannot change any cost denominator.
      if (spend > 0) complete = false;
      continue;
    }
    const result = results[0];
    const current = totals.get(result.key) ?? { spend: 0, results: 0 };
    current.spend += spend;
    current.results += result.value;
    totals.set(result.key, current);
  }
  if (summary.spend == null || Math.abs(sourceSpend - summary.spend) > Math.max(.005, Math.abs(summary.spend) * 1e-10)) complete = false;
  return resultBreakdown(summary).map(result => {
    const total = totals.get(result.key);
    const reconciled = total && Math.abs(total.results - result.value) <= Math.max(1e-8, result.value * 1e-10);
    const cost = complete && reconciled && total.results > 0
      ? total.spend / total.results
      : null;
    return { ...result, cost };
  });
}
