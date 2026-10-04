import { describe, expect, it } from "vitest";
import { applyProviderHealthEvent, type ProviderHealth } from "@/modules/integrations/provider-health";

describe("provider health", () => {
  it("resets failures after a successful call", () => {
    expect(applyProviderHealthEvent({ status: "degraded", consecutiveFailures: 2, lastErrorCode: "timeout", averageLatencyMs: 100 }, { ok: true, latencyMs: 200 })).toEqual({ status: "healthy", consecutiveFailures: 0, lastErrorCode: null, averageLatencyMs: 120 });
  });
  it("degrades and eventually blocks repeated failures", () => {
    let state: ProviderHealth = { status: "unknown", consecutiveFailures: 0, lastErrorCode: null, averageLatencyMs: null };
    for (let i = 0; i < 4; i++) state = applyProviderHealthEvent(state, { ok: false, errorCode: "rate_limited" });
    expect(state.status).toBe("degraded");
    state = applyProviderHealthEvent(state, { ok: false, errorCode: "rate_limited" });
    expect(state.status).toBe("blocked");
  });
});
