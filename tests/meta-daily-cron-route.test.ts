import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn(), backfill: vi.fn(), warm: vi.fn(), service: vi.fn(), prune: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/meta/daily-refresh", () => ({ listActiveMetaClients: mocks.list, runDailyMetaRefresh: mocks.run, backfillMetaHistory: mocks.backfill, warmStandardPeriods: mocks.warm }));
vi.mock("@/modules/meta/retention", () => ({ pruneMetaHistory: mocks.prune }));
import { GET } from "@/app/api/cron/meta-daily/route";

const secret = "s".repeat(40);
const targets = [{ agency_id: "a", client_id: "c1" }];
const call = (authorization?: string) => GET(new Request("https://app.example/api/cron/meta-daily", { headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", secret);
  vi.spyOn(console, "info").mockImplementation(() => {});
  mocks.service.mockReturnValue("service");
  mocks.list.mockResolvedValue(targets);
  mocks.run.mockResolvedValue({ clients: 1, refreshed: 1, failed: 0, skippedByBudget: 0, windows: [] });
  mocks.backfill.mockResolvedValue({ loaded: 1, complete: 0, failed: 0, skippedByBudget: 0 });
  mocks.prune.mockResolvedValue({ detailInsights: 3, detailActions: 9, aggregateScopes: 1, cutoff: "2026-04-09" });
  mocks.warm.mockResolvedValue({ warmed: 5, failed: 0, skippedByBudget: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("runs refresh, history block, retention and pre-computation in order for the scheduler's secret", async () => {
  const response = await call(`Bearer ${secret}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ clients: 1, refresh: { refreshed: 1 }, backfill: { loaded: 1 }, retention: { detailInsights: 3 }, warm: { warmed: 5 } });
  expect(mocks.run).toHaveBeenCalledWith("service", expect.objectContaining({ targets }));
  expect(mocks.backfill).toHaveBeenCalledWith("service", targets, expect.objectContaining({ budgetMs: expect.any(Number) }));
  expect(mocks.warm).toHaveBeenCalledWith("service", targets, expect.objectContaining({ budgetMs: expect.any(Number) }));
  const order = [mocks.run, mocks.backfill, mocks.prune, mocks.warm].map(mock => mock.mock.invocationCallOrder[0]);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

it("rejects other callers and stays unavailable without CRON_SECRET", async () => {
  expect((await call("Bearer " + "x".repeat(40))).status).toBe(401);
  expect((await call()).status).toBe(401);
  vi.stubEnv("CRON_SECRET", "");
  expect((await call(`Bearer ${secret}`)).status).toBe(503);
  expect(mocks.list).not.toHaveBeenCalled();
});

it("keeps going when one phase fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.run.mockRejectedValue(new Error("Meta down"));
  mocks.prune.mockRejectedValue(new Error("timeout"));
  const response = await call(`Bearer ${secret}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ refresh: null, backfill: { loaded: 1 }, retention: null, warm: { warmed: 5 } });
});
