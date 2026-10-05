import { describe, expect, it } from "vitest";
import { needsAnalyticsRefresh, ANALYTICS_REFRESH_MS, ANALYTICS_MAX_AUTOMATIC_FAILURES, analyticsRetryDelay } from "@/modules/client-portal/analytics-freshness";

describe("automatic analytics refresh", () => {
  const now = Date.parse("2026-10-02T16:30:00Z");
  const data = (age: number, status: "complete" | "partial" = "complete") => ({ coverage: {
    status, previousStatus: "complete" as const, latestCollectedAt: new Date(now - age).toISOString(),
    coveredDays: 4, previousCoveredDays: 4, totalDays: 4,
  } });
  it("preserves a complete analysis for the entire 60-minute tolerance", () => {
    expect(needsAnalyticsRefresh(data(30 * 60_000), now)).toBe(false);
    expect(needsAnalyticsRefresh(data(ANALYTICS_REFRESH_MS - 1), now)).toBe(false);
    expect(needsAnalyticsRefresh(data(ANALYTICS_REFRESH_MS), now)).toBe(true);
  });
  it("requests missing dates immediately even when other dates were updated recently", () => {
    expect(needsAnalyticsRefresh(data(1000, "partial"), now)).toBe(true);
  });
});

it("backs off automatic retries and caps the wait", () => {
  expect([1, 2, 3, 4, 5, 10].map(analyticsRetryDelay)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000]);
  expect(analyticsRetryDelay(0)).toBe(30_000);
  expect(ANALYTICS_MAX_AUTOMATIC_FAILURES).toBe(4);
});
