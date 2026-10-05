import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/meta/daily-refresh", () => ({ runDailyMetaRefresh: mocks.run }));
import { GET } from "@/app/api/cron/meta-daily/route";

const secret = "s".repeat(40);
const call = (authorization?: string) => GET(new Request("https://app.example/api/cron/meta-daily", { headers: authorization ? { authorization } : {} }));

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", secret); mocks.service.mockReturnValue("service"); mocks.run.mockResolvedValue({ clients: 1, refreshed: 1, failed: 0, skippedByBudget: 0, windows: [] }); });
afterEach(() => vi.unstubAllEnvs());

it("runs the daily refresh only for the scheduler's secret", async () => {
  expect((await call(`Bearer ${secret}`)).status).toBe(200);
  expect(mocks.run).toHaveBeenCalledWith("service", { budgetMs: 240_000 });
  expect((await call("Bearer " + "x".repeat(40))).status).toBe(401);
  expect((await call()).status).toBe(401);
  expect(mocks.run).toHaveBeenCalledTimes(1);
});

it("is unavailable until CRON_SECRET is configured", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await call(`Bearer ${secret}`)).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
