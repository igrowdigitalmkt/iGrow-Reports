import { describe, expect, it } from "vitest";
import { evaluateQueueHealth, queueHealthSummary } from "@/modules/integrations/queue-health";

describe("queue health", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  it("is healthy with no failures or stale jobs", () => {
    expect(evaluateQueueHealth({ queued: 2, collecting: 1, partial: 0, failed: 0, oldestQueuedAt: "2026-10-04T11:59:00Z", now })).toBe("healthy");
  });
  it("is degraded when retries are accumulating", () => {
    expect(evaluateQueueHealth({ queued: 1, collecting: 1, partial: 3, failed: 1, oldestQueuedAt: null, now })).toBe("degraded");
  });
  it("is blocked when jobs are stale or failures are systemic", () => {
    expect(evaluateQueueHealth({ queued: 1, collecting: 0, partial: 0, failed: 0, oldestQueuedAt: "2026-10-04T10:00:00Z", now })).toBe("blocked");
    expect(evaluateQueueHealth({ queued: 0, collecting: 0, partial: 0, failed: 10, oldestQueuedAt: null, now })).toBe("blocked");
  });
  it("returns a compact operational summary", () => {
    expect(queueHealthSummary({ queued: 2, collecting: 1, partial: 0, failed: 0, oldestQueuedAt: null, now })).toEqual({ status: "healthy", pending: 3, failed: 0, oldestQueuedAt: null });
  });
});
