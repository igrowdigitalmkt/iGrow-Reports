import type { AnalyticsValues } from "./analytics-types";

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
  return RESULT_GROUPS.flatMap(group => {
    const amount = values[`result:${group.key}`];
    return amount != null && amount > 0 ? [{ key: group.key, label: group.label, value: amount }] : [];
  });
}
