import { describe, expect, it, vi } from "vitest";
import { MetaApiError, MetaClient, type MetaInsight } from "@/modules/meta/client";
import { createMetaProviderAdapter } from "@/modules/meta/worker-adapter";
import { runProviderJob } from "@/modules/integrations/worker-runner";
import { transitionAfterError } from "@/modules/integrations/worker-contract";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";

const identity: CollectionIdentity = { clientId: "client-a", connectionId: "connection-a", provider: "meta", externalAccountId: "act_123", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "campaign", apiVersion: "v24.0", contractVersion: 1 };
const row: MetaInsight = { account_id: "123", campaign_id: "456", date_start: identity.dateFrom, date_stop: identity.dateTo, spend: "123456789012345678.12345678", impressions: "100", reach: "80", frequency: "1.25", clicks: "0", actions: [{ action_type: "lead", value: "0.1" }, { action_type: "lead", value: "0.2" }] };
function adapter(rows: MetaInsight[]) {
  const getPeriodInsights = vi.fn(async () => rows);
  return { worker: createMetaProviderAdapter(async () => ({ client: { getPeriodInsights }, currency: "BRL", timezone: "America/Sao_Paulo" })), getPeriodInsights };
}

describe("Meta job adapter", () => {
  it("normalizes exact period metrics without losing decimal precision or summing unique metrics", async () => {
    const { worker, getPeriodInsights } = adapter([row]);
    const result = await worker.collect(identity);
    expect(getPeriodInsights).toHaveBeenCalledWith({ adAccountId: "act_123", since: identity.dateFrom, until: identity.dateTo, level: "campaign" });
    expect(result.metrics.find(m => m.nativeKey === "spend")).toMatchObject({ value: row.spend, currency: "BRL", externalEntityId: "456", clientId: "client-a", connectionId: "connection-a", mappingVersion: 1 });
    expect(result.metrics.find(m => m.nativeKey === "reach")).toMatchObject({ aggregationRule: "non_additive", currency: null });
    expect(result.metrics.find(m => m.nativeKey === "clicks")).toMatchObject({ value: "0", state: "zero" });
    expect(result.metrics.find(m => m.nativeKey === "unique_clicks")).toMatchObject({ value: null, state: "unavailable" });
    expect(result.metrics.find(m => m.nativeKey === "action:lead")?.value).toBe("0.3");
  });

  it("stores only validated fields in sanitized provider payloads", async () => {
    const result = await adapter([{ ...row, access_token: "secret", campaign_name: "private campaign", paging: { next: "https://example.test?token=secret" } } as MetaInsight]).worker.collect(identity);
    const serialized = JSON.stringify(result.rawPayloads);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("private campaign");
    expect(serialized).not.toContain("example.test");
    expect(result.rawPayloads[0].endpoint).toBe("act_123/insights");
  });

  it("preserves large monetary action totals when combining decimal values", async () => {
    const result = await adapter([{ ...row, action_values: [{ action_type: "purchase", value: "123456789012345678.12345678" }, { action_type: "purchase", value: "0.00000001" }] }]).worker.collect(identity);
    expect(result.metrics.find(m => m.nativeKey === "value:action:purchase")?.value).toBe("123456789012345678.12345679");
  });

  it.each([
    { ...row, account_id: "999" }, { ...row, date_stop: "2026-10-04" },
    { ...row, campaign_id: undefined }, { ...row, spend: "NaN" }, { ...row, clicks: "-1" },
  ])("rejects foreign scope and malformed metric responses", async invalid => {
    await expect(adapter([invalid]).worker.collect(identity)).rejects.toThrow("invalid");
  });

  it("rejects duplicate period entities", async () => {
    await expect(adapter([row, row]).worker.collect(identity)).rejects.toThrow("invalid");
  });

  it("preserves an empty completed response without inventing metrics", async () => {
    expect(await adapter([]).worker.collect(identity)).toMatchObject({ complete: true, metrics: [], reconciliation: { confirmed: true, rowCount: 0 } });
  });

  it("rejects unsupported contracts before resolving credentials", async () => {
    const resolve = vi.fn();
    await expect(createMetaProviderAdapter(resolve).collect({ ...identity, contractVersion: 11 })).rejects.toThrow("invalid");
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    [new MetaApiError({ httpStatus: 429 }), "rate_limited"],
    [new MetaApiError({ httpStatus: 400, code: 4 }), "rate_limited"],
    [new MetaApiError({ httpStatus: 503 }), "provider_unavailable"],
    [new MetaApiError({ httpStatus: 400, code: 190 }), "auth"],
    [new MetaApiError({ httpStatus: 408, reason: "timeout" }), "timeout"],
  ] as const)("maps structured Meta failures to retry decisions", async (error, code) => {
    const worker = createMetaProviderAdapter(async () => ({ client: { getPeriodInsights: async () => { throw error; } }, currency: "BRL", timezone: "America/Sao_Paulo" }));
    try { await worker.collect(identity); throw new Error("Expected provider failure"); }
    catch (failure) { expect(transitionAfterError(failure, 1).errorCode).toBe(code); }
  });

  it("runs the paginated Meta client through the worker and persists only after every page succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [row], paging: { next: "https://graph.facebook.com/next", cursors: { after: "page2" } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ ...row, campaign_id: "457" }] })));
    const client = new MetaClient({ accessToken: "secret", apiVersion: identity.apiVersion, fetchImpl });
    const persist = vi.fn(async () => undefined);
    const transition = vi.fn(async () => undefined);
    await runProviderJob(createMetaProviderAdapter(async () => ({ client, currency: "BRL", timezone: "America/Sao_Paulo" })), identity, { persistResult: persist, markTransition: transition });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith({ status: "confirmed", nextAttemptAt: null });
    expect(persist.mock.invocationCallOrder[0]).toBeGreaterThan(fetchImpl.mock.invocationCallOrder[1]);
  });

  it("does not persist a partial page set when a later page fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: [row], paging: { next: "https://graph.facebook.com/next", cursors: { after: "page2" } } })))
      .mockResolvedValue(new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }));
    const client = new MetaClient({ accessToken: "secret", apiVersion: identity.apiVersion, fetchImpl });
    const persist = vi.fn(async () => undefined);
    const transition = vi.fn(async () => undefined);
    await runProviderJob(createMetaProviderAdapter(async () => ({ client, currency: "BRL", timezone: "America/Sao_Paulo" })), identity, { persistResult: persist, markTransition: transition });
    expect(persist).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorCode: "auth" }));
  });
});
