import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), collect: vi.fn(), revalidate: vi.fn(), analytics: vi.fn(), fresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/modules/client-portal/context", () => ({ requireClientDashboardAccess: mocks.access }));
vi.mock("@/modules/meta/server", () => ({ collectMetaClientInsights: mocks.collect, MetaSetupError: class extends Error {} }));
vi.mock("@/modules/meta/client", () => ({ MetaApiError: class extends Error {} }));
vi.mock("@/modules/client-portal/analytics", () => ({ getClientAnalytics: mocks.analytics }));
vi.mock("@/modules/client-portal/analytics-live", () => ({ getFreshClientAnalytics: mocks.fresh }));
import { collectDashboardData } from "@/modules/client-portal/analytics-actions";

const clientId = "94e033bc-1fe7-4ddb-868d-e2f07b998dae";
const coverage = (status: "complete" | "partial", previousStatus: "complete" | "partial" = "complete", coveredDays = status === "complete" ? 30 : 7) => ({
  coverage: {
    status,
    previousStatus,
    latestCollectedAt: new Date().toISOString(),
    coveredDays,
    previousCoveredDays: previousStatus === "complete" ? 30 : 7,
    totalDays: 30,
  },
});
function access(canCollect = true) {
  return { canCollect, access: { agencyId: "agency-from-verified-client" }, user: { id: "verified-user" },
    supabase: { rpc: () => ({ single: async () => ({ data: { timezone_name: "America/Sao_Paulo" } }) }) } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(access());
  mocks.collect.mockResolvedValue({ insightCount: 42, completedSliceCount: 4, failures: [] });
  mocks.analytics.mockResolvedValue(coverage("complete"));
  mocks.fresh.mockResolvedValue({ ...coverage("complete"), metaAggregate: { confirmed: true } });
});
describe("dashboard collection authorization", () => {
  it("does not claim success when daily collection finishes without exact period confirmation", async () => {
    mocks.fresh.mockResolvedValue({ ...coverage("complete"), metaAggregate: { confirmed: false } });
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" }))
      .toMatchObject({ error: expect.stringContaining("agregados do período"), insightCount: 42 });
  });
  it("checks freshness for an authorized reader without allowing forced refresh", async () => {
    mocks.access.mockResolvedValue(access(false));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30", automatic: true })).toEqual({ success: true, insightCount: 0 });
    expect(mocks.collect).not.toHaveBeenCalled();
    mocks.analytics.mockReset()
      .mockResolvedValueOnce(coverage("partial"))
      .mockResolvedValueOnce(coverage("complete"));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30", automatic: true })).toHaveProperty("success", true);
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({ agencyId: "agency-from-verified-client", clientId, forceRefresh: false }));
  });
  it("refuses a client reader before privileged collection", async () => {
    mocks.access.mockResolvedValue(access(false));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" })).toHaveProperty("error");
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("uses the agency verified for the client, independent of the selected cookie", async () => {
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" })).toEqual({ success: true, insightCount: 42 });
    expect(mocks.collect).toHaveBeenCalledWith({ agencyId: "agency-from-verified-client", clientId, actorId: "verified-user", since: "2025-09-01", until: "2025-09-30", forceRefresh: true });
  });
  it("rejects invalid calendar dates before collection", async () => {
    expect(await collectDashboardData({ clientId, from: "2025-02-30", to: "2025-03-01" })).toHaveProperty("error");
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("backfills comparison even when the current period is fresh", async () => {
    mocks.analytics.mockResolvedValue(coverage("complete", "partial"));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30", automatic: true })).toEqual({ success: true, insightCount: 42 });
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({ since: "2025-08-02", until: "2025-08-31", forceRefresh: false }));
  });
  it("updates the current period and missing comparison separately", async () => {
    mocks.analytics.mockResolvedValue(coverage("complete", "partial"));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" })).toEqual({ success: true, insightCount: 84 });
    expect(mocks.collect).toHaveBeenCalledTimes(2);
    expect(mocks.collect).toHaveBeenNthCalledWith(1, expect.objectContaining({ since: "2025-09-01", until: "2025-09-30", forceRefresh: true }));
    expect(mocks.collect).toHaveBeenNthCalledWith(2, expect.objectContaining({ since: "2025-08-02", until: "2025-08-31", forceRefresh: false }));
  });
  it("does not recursively backfill another period when repairing comparison explicitly", async () => {
    mocks.analytics.mockResolvedValue(coverage("complete", "partial"));
    await collectDashboardData({ clientId, from: "2025-08-02", to: "2025-08-31", includeComparison: false });
    expect(mocks.collect).toHaveBeenCalledTimes(1);
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({ since: "2025-08-02", until: "2025-08-31", forceRefresh: true }));
  });
  it("repairs a partial manual refresh without recollecting slices that are already complete", async () => {
    mocks.analytics.mockReset()
      .mockResolvedValueOnce(coverage("partial", "complete", 7))
      .mockResolvedValueOnce(coverage("complete"));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" })).toEqual({ success: true, insightCount: 42 });
    expect(mocks.collect).toHaveBeenCalledWith(expect.objectContaining({
      since: "2025-09-01", until: "2025-09-30", forceRefresh: false,
    }));
  });
  it("blocks the dashboard when collection still has missing days after the attempt", async () => {
    mocks.collect.mockResolvedValue({ insightCount: 42, completedSliceCount: 0, failures: [{ code: "4" }] });
    mocks.analytics.mockReset()
      .mockResolvedValueOnce(coverage("partial", "complete", 7))
      .mockResolvedValueOnce(coverage("partial", "complete", 7));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" }))
      .toMatchObject({ error: expect.stringContaining("7/30"), insightCount: 42 });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/cliente/${clientId}`);
  });
  it("does not claim the current period is incomplete when only auxiliary/comparison work failed", async () => {
    mocks.collect.mockResolvedValue({ insightCount: 42, completedSliceCount: 1, failures: [{ code: "504" }] });
    mocks.analytics.mockResolvedValue(coverage("complete"));
    const result = await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" });
    expect(result).toMatchObject({ error: expect.stringContaining("período atual foi concluído"), insightCount: 42 });
  });
});
