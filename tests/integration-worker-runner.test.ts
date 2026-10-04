import { describe, expect, it, vi } from "vitest";
import { runProviderJob } from "@/modules/integrations/worker-runner";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";

const identity: CollectionIdentity = { clientId: "c", connectionId: "i", provider: "meta", externalAccountId: "act_1", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign", apiVersion: "v24.0", contractVersion: 1 };

describe("provider worker runner", () => {
  it("persists before confirming a successful collection", async () => {
    const order: string[] = [];
    const adapter = { provider: "meta", collect: vi.fn(async () => ({ metrics: [], complete: true, reconciliation: {}, rawPayloads: [] })) };
    await runProviderJob(adapter, identity, { persistResult: async () => { order.push("persist"); }, markTransition: async t => { order.push(t.status); } });
    expect(order).toEqual(["persist", "confirmed"]);
  });

  it("records a retry transition when the provider is temporarily unavailable", async () => {
    const transition = vi.fn();
    await runProviderJob({ provider: "meta", collect: async () => { throw new Error("HTTP 503 unavailable"); } }, identity, { persistResult: async () => undefined, markTransition: transition });
    expect(transition.mock.calls[0][0]).toMatchObject({ status: "partial", errorCode: "provider_unavailable" });
  });

  it("uses the persisted attempt count when calculating retry delay", async () => {
    const transition = vi.fn();
    const now = Date.now();
    await runProviderJob({ provider: "meta", collect: async () => { throw new Error("timeout"); } }, identity, { persistResult: async () => undefined, markTransition: transition }, 2);
    const next = Date.parse(transition.mock.calls[0][0].nextAttemptAt);
    expect(next).toBeGreaterThan(now + 45_000);
  });
});
