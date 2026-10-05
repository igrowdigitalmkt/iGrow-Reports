import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), all: vi.fn(), missing: vi.fn(), service: vi.fn(), enqueue: vi.fn(), refresh: vi.fn(), drain: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/modules/client-portal/context", () => ({ requireClientDashboardAccess: mocks.access }));
vi.mock("@/modules/client-portal/snapshot-series-loader", () => ({ resolveSeriesIdentities: mocks.all, resolveSeriesMissingIdentities: mocks.missing }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/integrations/repository", () => ({ enqueueDailyCollectionJobs: mocks.enqueue, requestDailyMetaCollectionRefresh: mocks.refresh }));
vi.mock("@/modules/meta/inline-drain", () => ({ scheduleMetaQueueDrain: mocks.drain }));
import { requestSeriesData } from "@/modules/client-portal/snapshot-series-actions";

const input = { clientId: "11111111-0000-4000-8000-000000000001", accountId: "50000000-0000-4000-8000-000000000001", from: "2026-10-01", to: "2026-10-02" };
const day = (date: string) => ({ dateFrom: date, dateTo: date });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ canCollect: true, supabase: "session" });
  mocks.service.mockReturnValue("service");
  mocks.all.mockResolvedValue([day("2026-10-01"), day("2026-10-02")]);
  mocks.missing.mockResolvedValue([day("2026-10-02")]);
  mocks.enqueue.mockResolvedValue(1);
  mocks.refresh.mockResolvedValue({ created: 0, rescheduled: 2, preserved: 0 });
});

it("enqueues only missing days and drains the queue", async () => {
  expect(await requestSeriesData(input)).toEqual({ success: true, created: 1 });
  expect(mocks.enqueue).toHaveBeenCalledWith("service", [day("2026-10-02")]);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.drain).toHaveBeenCalledWith("service");
});

it("refreshes every day of the period from authenticated identities", async () => {
  expect(await requestSeriesData({ ...input, refresh: true, connectionId: "foreign" })).toEqual({ success: true, created: 2 });
  expect(mocks.all).toHaveBeenCalledWith("session", input.clientId, input.accountId, input.from, input.to);
  expect(mocks.refresh).toHaveBeenCalledWith("service", [day("2026-10-01"), day("2026-10-02")]);
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.drain).toHaveBeenCalledWith("service");
});

it("blocks profiles that cannot collect before privileged work", async () => {
  mocks.access.mockResolvedValue({ canCollect: false });
  expect(await requestSeriesData({ ...input, refresh: true })).toHaveProperty("error");
  expect(mocks.all).not.toHaveBeenCalled();
  expect(mocks.service).not.toHaveBeenCalled();
});
