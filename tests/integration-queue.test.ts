import { describe, expect, it } from "vitest";
import { classifyCollectionError, compareJobs, computeRetry, isClaimable } from "@/modules/integrations/queue";

describe("integration queue", () => {
  it("retries provider throttling and increases the delay", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    expect(computeRetry(new Error("HTTP 429"), 0, now)).toEqual({ retryable: true, code: "rate_limited", nextAttemptAt: "2026-10-04T12:01:00.000Z" });
    expect(computeRetry(new Error("timeout"), 1, now).nextAttemptAt).toBe("2026-10-04T12:00:30.000Z");
  });

  it("does not retry authentication or invalid request errors", () => {
    expect(classifyCollectionError(new Error("401 token revoked"))).toBe("auth");
    expect(computeRetry(new Error("400 invalid parameter"), 0).retryable).toBe(false);
  });

  it("orders lower priority number first and then earliest retry", () => {
    const base = { id: "", idempotencyKey: "", status: "queued" as const, attemptCount: 0 };
    const later = { ...base, id: "later", priority: 20, nextAttemptAt: "2026-10-04T12:05:00Z" };
    const sooner = { ...base, id: "sooner", priority: 20, nextAttemptAt: "2026-10-04T12:01:00Z" };
    expect(compareJobs(sooner, later)).toBeLessThan(0);
  });

  it("claims only ready queued or partial jobs", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    const job = { id: "1", idempotencyKey: "x", status: "partial" as const, priority: 1, attemptCount: 1, nextAttemptAt: "2026-10-04T11:59:00Z" };
    expect(isClaimable(job, now)).toBe(true);
    expect(isClaimable({ ...job, status: "confirmed" }, now)).toBe(false);
    expect(isClaimable({ ...job, nextAttemptAt: "2026-10-04T12:01:00Z" }, now)).toBe(false);
  });
});
