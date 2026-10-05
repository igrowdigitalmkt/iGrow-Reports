import type { AnalyticsDashboardData } from "./analytics-types";

// Daily rows are refreshed by the scheduled job (src/modules/meta/daily-refresh.ts)
// every morning; the dashboard collects on its own only when a day is missing or
// the last collection is older than a day plus margin (e.g. the job did not run).
export const ANALYTICS_REFRESH_MS = 26 * 60 * 60 * 1000;
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
