import type { MetaInsight } from "./client";
import type { AnalyticsValues } from "@/modules/client-portal/analytics-types";
import { aggregateResults } from "@/modules/client-portal/analytics-results";

// Results are chosen by Meta for this entity's optimization goal. Secondary
// actions must remain separate metrics, rather than inflate the Results column.
export function providerResultValues(row: MetaInsight): AnalyticsValues | null {
  const counts: AnalyticsValues = { "result:provider_known": 1 };
  if (!Array.isArray(row.results)) return null;
  for (const result of row.results) {
    if (!result || typeof result !== "object") return null;
    const entry = result as Record<string, unknown>;
    const indicator = typeof entry.indicator === "string" ? entry.indicator.replace(/^actions:/, "action:") : null;
    const list = Array.isArray(entry.values) ? entry.values : [];
    // Attribution windows are alternative views, not additive counts.
    if (!indicator || list.length !== 1 || !list[0] || typeof list[0] !== "object") return null;
    const amount = Number((list[0] as Record<string, unknown>).value);
    if (!Number.isFinite(amount) || amount < 0 || counts[`result:provider:${indicator}`] != null) return null;
    counts[`result:provider:${indicator}`] = amount;
  }
  return counts;
}

export function providerResultTotals(rows: MetaInsight[]): AnalyticsValues | null {
  const totals: AnalyticsValues = { "result:provider_known": 1 };
  for (const row of rows) {
    const values = providerResultValues(row);
    if (!values) return null;
    for (const [key, amount] of Object.entries(values)) {
      if (key.startsWith("result:provider:")) totals[key] = (totals[key] ?? 0) + (amount ?? 0);
    }
  }
  return totals;
}

const FALLBACK_PROVIDER_RESULTS = [
  { group: "messages", indicator: "action:onsite_conversion.messaging_conversation_started_7d" },
  { group: "profile_visits", indicator: "instagram_profile_visits" },
  { group: "leads", indicator: "action:lead" },
  { group: "registrations", indicator: "action:complete_registration" },
  { group: "purchases", indicator: "action:purchase" },
] as const;

// Some campaign insight rows omit the provider "results" field even though
// their compatible conversion action is present. Resolve that campaign only;
// never let one omitted field force the whole overview back to account actions.
export function campaignResultValues(row: MetaInsight): AnalyticsValues | null {
  const provider = providerResultValues(row);
  if (provider) return provider;

  const actionValues: AnalyticsValues = {};
  for (const action of row.actions ?? []) {
    const amount = Number(action.value);
    if (!Number.isFinite(amount) || amount < 0) continue;
    actionValues[`action:${action.action_type}`] = (actionValues[`action:${action.action_type}`] ?? 0) + amount;
  }
  if (row.instagram_profile_visits != null) {
    const amount = Number(row.instagram_profile_visits);
    if (Number.isFinite(amount) && amount >= 0) actionValues.instagram_profile_visits = amount;
  }

  const fallback = aggregateResults(actionValues, false);
  const resolved: AnalyticsValues = { "result:provider_known": 1 };
  let found = false;
  for (const item of FALLBACK_PROVIDER_RESULTS) {
    const amount = fallback[`result:${item.group}`];
    if (amount == null) continue;
    resolved[`result:provider:${item.indicator}`] = amount;
    found = true;
  }
  if (found) return resolved;

  // An explicit empty provider result means zero. Missing provider data with
  // no compatible action remains unknown rather than fabricating a zero.
  return Array.isArray(row.results) && row.results.length === 0 ? resolved : null;
}

export function campaignResultTotals(rows: MetaInsight[]): AnalyticsValues | null {
  const totals: AnalyticsValues = { "result:provider_known": 1 };
  for (const row of rows) {
    const values = campaignResultValues(row);
    if (!values) return null;
    for (const [key, amount] of Object.entries(values)) {
      if (key.startsWith("result:provider:")) totals[key] = (totals[key] ?? 0) + (amount ?? 0);
    }
  }
  return totals;
}
