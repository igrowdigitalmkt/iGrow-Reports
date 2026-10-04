import { describe, expect, it } from "vitest";
import { transitionAfterCollection, transitionAfterError } from "@/modules/integrations/worker-contract";

describe("worker transitions", () => {
  it.each([
    new Error("HTTP 503 https://provider.test?access_token=secret"),
    new Error("401 Authorization: Bearer secret"),
    { password: "secret" },
  ])("does not persist raw provider exceptions", error => {
    const transition = transitionAfterError(error, 1);
    expect(transition.errorMessage).not.toContain("secret");
    expect(transition.errorMessage).not.toContain("[object Object]");
    expect(transition.errorMessage).not.toContain("provider.test");
  });
  it("confirms only a complete provider result", () => {
    expect(transitionAfterCollection({ metrics: [], complete: true, reconciliation: {}, rawPayloads: [] })).toEqual({ status: "confirmed", nextAttemptAt: null });
    expect(transitionAfterCollection({ metrics: [], complete: false, reconciliation: {}, rawPayloads: [] }).status).toBe("partial");
  });

  it("does not confirm a complete response that failed reconciliation", () => {
    expect(transitionAfterCollection({ metrics: [], complete: true, reconciliation: { confirmed: false }, rawPayloads: [] }).status).toBe("partial");
  });

  it("requeues temporary provider failures", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    const result = transitionAfterError(new Error("HTTP 503 unavailable"), 0, now);
    expect(result.status).toBe("partial");
    expect(result.errorCode).toBe("provider_unavailable");
    expect(result.nextAttemptAt).toBe("2026-10-04T12:00:15.000Z");
  });

  it("fails permanently on invalid credentials", () => {
    const result = transitionAfterError(new Error("401 token revoked"), 2, new Date("2026-10-04T12:00:00Z"));
    expect(result.status).toBe("failed");
    expect(result.nextAttemptAt).toBeNull();
    expect(result.errorCode).toBe("auth");
  });
});
