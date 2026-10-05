import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), service: vi.fn(), prune: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/meta/daily-refresh", () => ({ runDailyMetaRefresh: mocks.run }));
vi.mock("@/modules/meta/retention", () => ({ pruneMetaHistory: mocks.prune }));
import { GET } from "@/app/api/cron/meta-daily/route";

const secret = "s".repeat(40);
const call = (authorization?: string) => GET(new Request("https://app.example/api/cron/meta-daily", { headers: authorization ? { authorization } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", secret);
  mocks.service.mockReturnValue("service");
  mocks.run.mockResolvedValue({ clients: 1, refreshed: 1, failed: 0, skippedByBudget: 0, windows: [] });
  mocks.prune.mockResolvedValue({ detailInsights: 3, detailActions: 9, aggregateScopes: 1, cutoff: "2026-04-09" });
});
afterEach(() => vi.unstubAllEnvs());

it("runs the daily refresh and retention only for the scheduler's secret", async () => {
  const response = await call(`Bearer ${secret}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ refreshed: 1, retention: { detailInsights: 3 } });
  expect(mocks.run).toHaveBeenCalledWith("service", { budgetMs: 200_000 });
  expect(mocks.prune).toHaveBeenCalledWith("service");
  expect((await call("Bearer " + "x".repeat(40))).status).toBe(401);
  expect((await call()).status).toBe(401);
  expect(mocks.run).toHaveBeenCalledTimes(1);
});

it("is unavailable until CRON_SECRET is configured", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await call(`Bearer ${secret}`)).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});

it("still reports the refresh when retention fails", async () => {
  mocks.prune.mockRejectedValue(new Error("timeout"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await call(`Bearer ${secret}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ refreshed: 1, retention: null });
  log.mockRestore();
});
