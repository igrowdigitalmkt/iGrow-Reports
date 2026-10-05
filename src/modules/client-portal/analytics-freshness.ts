import type { AnalyticsDashboardData } from "./analytics-types";

export const ANALYTICS_REFRESH_MS = 60 * 60 * 1000;
export const ANALYTICS_PARTIAL_RETRY_MS = 30 * 1000;
// Automatic attempts on an incomplete period back off (30 s, 1, 2, 4 min) and
// pause after this many consecutive failures; each attempt is a heavy read.
export const ANALYTICS_MAX_AUTOMATIC_FAILURES = 4;
export const ANALYTICS_MAX_RETRY_MS = 10 * 60 * 1000;
export function analyticsRetryDelay(failures: number) {
  return Math.min(ANALYTICS_PARTIAL_RETRY_MS * 2 ** Math.max(0, failures - 1), ANALYTICS_MAX_RETRY_MS);
}
export function needsAnalyticsRefresh(data: Pick<AnalyticsDashboardData, "coverage">, now = Date.now()) {
  const updated = Date.parse(data.coverage.latestCollectedAt ?? "");
  return data.coverage.status !== "complete" || !Number.isFinite(updated) || now - updated >= ANALYTICS_REFRESH_MS;
}
export function needsAnalyticsAccessRefresh(data: Pick<AnalyticsDashboardData, "coverage">, now = Date.now()) {
  // Coalesce the immediate refresh after an action; each subsequent access
  // updates recent dates while the collector reuses completed historical lots.
  return needsAnalyticsRefresh(data, now) || now - Date.parse(data.coverage.latestCollectedAt ?? "") > 10_000;
}
