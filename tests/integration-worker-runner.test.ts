import { describe, expect, it, vi } from "vitest";
import { runProviderJob } from "@/modules/integrations/worker-runner";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";

const identity: CollectionIdentity = { clientId: "c", connectionId: "i", provider: "meta", externalAccountId: "act_1", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign", apiVersion: "v24.0", contractVersion: 1 };

describe("provider worker runner", () => {
  const successfulAdapter = { provider: "meta" as const, collect: async () => ({ metrics: [], complete: true, reconciliation: {}, rawPayloads: [] }) };

  it("retries persistence failures without blaming the provider or recording raw errors", async () => {
    const transition = vi.fn(async () => undefined);
    const health = vi.fn(async () => undefined);
    await runProviderJob(successfulAdapter, identity, {
      persistResult: async () => { throw new Error("database unavailable password=secret"); },
      markTransition: transition, recordHealth: health,
    });
    expect(transition).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: "partial", errorCode: "persistence_error", nextAttemptAt: expect.any(String) }));
    expect(JSON.stringify(transition.mock.calls)).not.toContain("secret");
    expect(health).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("does not attempt another transition when finalization fails", async () => {
    const transition = vi.fn(async () => { throw new Error("database unavailable"); });
    const health = vi.fn();
    await expect(runProviderJob(successfulAdapter, identity, { persistResult: async () => undefined, markTransition: transition, recordHealth: health })).rejects.toThrow("database unavailable");
    expect(transition).toHaveBeenCalledTimes(1);
    expect(health).not.toHaveBeenCalled();
  });

  it.each([true, false])("finalizes before a monitoring failure (provider success: %s)", async ok => {
    const transition = vi.fn(async () => undefined);
    const health = vi.fn(async () => { throw new Error("health unavailable"); });
    const adapter = ok ? successfulAdapter : { provider: "meta" as const, collect: async () => { throw new Error("HTTP 503 access_token=secret"); } };
    await expect(runProviderJob(adapter, identity, { persistResult: async () => undefined, markTransition: transition, recordHealth: health })).rejects.toThrow("health unavailable");
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ status: ok ? "confirmed" : "partial" }));
    expect(JSON.stringify(transition.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(health.mock.calls)).not.toContain("secret");
    expect(health).toHaveBeenCalledWith(expect.objectContaining(ok ? { ok: true } : { ok: false, errorCode: "provider_unavailable" }));
    expect(transition.mock.invocationCallOrder[0]).toBeLessThan(health.mock.invocationCallOrder[0]);
  });

  it("persists before confirming a successful collection", async () => {
    const order: string[] = [];
    const adapter = { provider: "meta" as const, collect: vi.fn(async () => ({ metrics: [], complete: true, reconciliation: {}, rawPayloads: [] })) };
    await runProviderJob(adapter, identity, { persistResult: async () => { order.push("persist"); }, markTransition: async t => { order.push(t.status); } });
    expect(order).toEqual(["persist", "confirmed"]);
  });

  it("records a retry transition when the provider is temporarily unavailable", async () => {
    const transition = vi.fn();
    await runProviderJob({ provider: "meta" as const, collect: async () => { throw new Error("HTTP 503 unavailable"); } }, identity, { persistResult: async () => undefined, markTransition: transition });
    expect(transition.mock.calls[0][0]).toMatchObject({ status: "partial", errorCode: "provider_unavailable" });
  });

  it("uses the persisted attempt count when calculating retry delay", async () => {
    const transition = vi.fn();
    const now = Date.now();
    await runProviderJob({ provider: "meta" as const, collect: async () => { throw new Error("timeout"); } }, identity, { persistResult: async () => undefined, markTransition: transition }, 2);
    const next = Date.parse(transition.mock.calls[0][0].nextAttemptAt);
    expect(next).toBeGreaterThan(now + 45_000);
  });

  it("records provider health for both success and failure", async () => {
    const health = vi.fn(async () => undefined);
    await runProviderJob({ provider: "meta" as const, collect: async () => ({ metrics: [], complete: true, reconciliation: {}, rawPayloads: [] }) }, identity, { persistResult: async () => undefined, markTransition: async () => undefined, recordHealth: health });
    expect(health).toHaveBeenNthCalledWith(1, expect.objectContaining({ ok: true }));
    await runProviderJob({ provider: "meta" as const, collect: async () => { throw new Error("timeout"); } }, identity, { persistResult: async () => undefined, markTransition: async () => undefined, recordHealth: health });
    expect(health).toHaveBeenNthCalledWith(2, expect.objectContaining({ ok: false }));
  });
});
