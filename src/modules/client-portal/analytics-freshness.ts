import type { AnalyticsDashboardData } from "./analytics-types";

export const ANALYTICS_REFRESH_MS = 60 * 60 * 1000;
export const ANALYTICS_PARTIAL_RETRY_MS = 30 * 1000;
export function needsAnalyticsRefresh(data: Pick<AnalyticsDashboardData, "coverage">, now = Date.now()) {
  const updated = Date.parse(data.coverage.latestCollectedAt ?? "");
  return data.coverage.status !== "complete" || !Number.isFinite(updated) || now - updated >= ANALYTICS_REFRESH_MS;
}
export function needsAnalyticsAccessRefresh(data: Pick<AnalyticsDashboardData, "coverage">, now = Date.now()) {
  // Coalesce the immediate refresh after an action; each subsequent access
  // updates recent dates while the collector reuses completed historical lots.
  return needsAnalyticsRefresh(data, now) || now - Date.parse(data.coverage.latestCollectedAt ?? "") > 10_000;
}
