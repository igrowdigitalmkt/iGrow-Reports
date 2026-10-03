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
  if (values["result:provider_known"] === 1) {
    const total = Object.entries(values).filter(([key]) => key.startsWith("result:provider:")).reduce((sum, [, amount]) => sum + (amount ?? 0), 0);
    next.primary_results = total;
    next.cost_per_result = total > 0 && values.spend != null ? values.spend / total : null;
    return next;
  }
  let total = 0, available = false;
  for (const group of RESULT_GROUPS) {
    const existing = values[`result:${group.key}`];
    const amount = existing ?? group.fields.map(key => values[key]).find(value => value != null);
    next[`result:${group.key}`] = amount ?? null;
    if (amount != null) { total += amount; available = true; }
  }
  next.primary_results = available || complete || values.primary_results === 0 ? total : null;
  next.cost_per_result = next.primary_results && values.spend != null ? values.spend / next.primary_results : null;
  return next;
}

export function resultBreakdown(values: AnalyticsValues) {
  if (values["result:provider_known"] === 1) return Object.entries(values).flatMap(([key, value]) => key.startsWith("result:provider:") && value != null && value > 0
    ? [{ key, label: metaMetricLabel(key.slice("result:provider:".length), key.slice("result:provider:".length)), value }] : []);
  return RESULT_GROUPS.flatMap(group => {
    const amount = values[`result:${group.key}`];
    return amount != null && amount > 0 ? [{ key: group.key, label: group.label, value: amount }] : [];
  });
}

function resultFamilyKey(key: string) {
  if (RESULT_GROUPS.some(group => group.key === key)) return key;
  const providerKey = key.startsWith("result:provider:") ? key.slice("result:provider:".length) : key;
  const group = RESULT_GROUPS.find(item => item.fields.some(field => field === providerKey));
  return group?.key ?? key;
}

export function resultCostBreakdown(summary: AnalyticsValues, sources: Array<{ values: AnalyticsValues }>) {
  const totals = new Map<string, { spend: number; results: number }>();
  for (const source of sources) {
    const values = aggregateResults(source.values, true);
    const spend = values.spend;
    if (spend == null || spend < 0) continue;
    for (const result of resultBreakdown(values)) {
      const familyKey = resultFamilyKey(result.key);
      const current = totals.get(familyKey) ?? { spend: 0, results: 0 };
      current.spend += spend;
      current.results += result.value;
      totals.set(familyKey, current);
    }
  }
  return resultBreakdown(summary).map(result => {
    const total = totals.get(resultFamilyKey(result.key));
    return { ...result, cost: total && total.results > 0 ? total.spend / total.results : null };
  });
}
