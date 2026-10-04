import { describe, expect, it } from "vitest";
import { canStartProviderJob, collectionPriority, providerConcurrency } from "@/modules/integrations/scheduler-policy";

const identity = { clientId: "c", connectionId: "i", provider: "meta" as const, externalAccountId: "a", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign" as const, apiVersion: "v1", contractVersion: 1 };

describe("scheduler policy", () => {
  it("prioritizes visible and recent data for fast dashboard refresh", () => {
    expect(collectionPriority({ ...identity, isVisibleToUser: true, isRecent: true })).toBe(10);
    expect(collectionPriority({ ...identity, isRecent: true })).toBe(20);
    expect(collectionPriority({ ...identity, hasConfirmedSnapshot: false })).toBe(30);
    expect(collectionPriority({ ...identity, hasConfirmedSnapshot: true })).toBe(100);
  });

  it("keeps provider limits explicit and isolated", () => {
    expect(providerConcurrency("meta").maxInFlight).toBe(2);
    expect(providerConcurrency("tiktok").minIntervalMs).toBeGreaterThan(providerConcurrency("google").minIntervalMs);
    expect(providerConcurrency("unknown").maxInFlight).toBe(1);
  });

  it("blocks jobs above concurrency or interval limits", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(canStartProviderJob("meta", 1, new Date("2026-10-04T11:59:59.800Z"), now)).toBe(false);
    expect(canStartProviderJob("meta", 2, null, now)).toBe(false);
    expect(canStartProviderJob("meta", 1, new Date("2026-10-04T11:59:00Z"), now)).toBe(true);
  });
});
