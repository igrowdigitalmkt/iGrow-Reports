import type { MetaInsight } from "./client";
import type { AnalyticsValues } from "@/modules/client-portal/analytics-types";

// Results are chosen by Meta for this entity's optimization goal. Secondary
// actions must remain separate metrics, rather than inflate the Results column.
export function providerResultValues(row: MetaInsight): AnalyticsValues | null {
  const counts: AnalyticsValues = { "result:provider_known": 1 };
  if (!Array.isArray(row.results)) {
    // Meta can omit Results entirely for a campaign row that had no delivery.
    // That row contributes exactly zero to every Results family and must not
    // invalidate otherwise complete campaign totals.
    const spend = row.spend == null ? null : Number(row.spend);
    const impressions = row.impressions == null ? null : Number(row.impressions);
    return spend === 0 && impressions === 0 ? counts : null;
  }
  for (const result of row.results) {
    if (!result || typeof result !== "object") return null;
    const entry = result as Record<string, unknown>;
    const indicator = typeof entry.indicator === "string" ? entry.indicator.replace(/^actions:/, "action:") : null;
    const list = Array.isArray(entry.values) ? entry.values : [];
    // Attribution windows are alternative views, not additive counts.
    if (!indicator || list.length !== 1 || !list[0] || typeof list[0] !== "object") return null;
    const raw = (list[0] as Record<string, unknown>).value;
    if ((typeof raw !== "string" && typeof raw !== "number") || (typeof raw === "string" && !raw.trim())) return null;
    const amount = Number(raw);
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

// A campaign's actions include secondary outcomes. They cannot establish which
// outcome Meta selected for its Results column when that native field is absent.
export function campaignResultValues(row: MetaInsight): AnalyticsValues | null {
  return providerResultValues(row);
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
