import type { MetaInsight } from "./client";
import type { AnalyticsValues } from "@/modules/client-portal/analytics-types";

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
