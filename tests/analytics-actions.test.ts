import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ access: vi.fn(), collect: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/modules/client-portal/context", () => ({ requireClientDashboardAccess: mocks.access }));
vi.mock("@/modules/meta/server", () => ({ collectMetaClientInsights: mocks.collect, MetaSetupError: class extends Error {} }));
vi.mock("@/modules/meta/client", () => ({ MetaApiError: class extends Error {} }));
import { collectDashboardData } from "@/modules/client-portal/analytics-actions";

const clientId = "94e033bc-1fe7-4ddb-868d-e2f07b998dae";
function access(canCollect = true) {
  return { canCollect, access: { agencyId: "agency-from-verified-client" }, user: { id: "verified-user" },
    supabase: { rpc: () => ({ single: async () => ({ data: { timezone_name: "America/Sao_Paulo" } }) }) } };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(access());
  mocks.collect.mockResolvedValue({ insightCount: 42, completedSliceCount: 4, failures: [] });
});
describe("dashboard collection authorization", () => {
  it("refuses a client reader before privileged collection", async () => {
    mocks.access.mockResolvedValue(access(false));
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" })).toHaveProperty("error");
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("uses the agency verified for the client, independent of the selected cookie", async () => {
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" })).toEqual({ success: true, insightCount: 42 });
    expect(mocks.collect).toHaveBeenCalledWith({ agencyId: "agency-from-verified-client", clientId, actorId: "verified-user", since: "2025-09-01", until: "2025-09-30" });
  });
  it("rejects invalid calendar dates before collection", async () => {
    expect(await collectDashboardData({ clientId, from: "2025-02-30", to: "2025-03-01" })).toHaveProperty("error");
    expect(mocks.collect).not.toHaveBeenCalled();
  });
  it("reports partial completion and invalidates the persisted view", async () => {
    mocks.collect.mockResolvedValue({ insightCount: 42, completedSliceCount: 3, failures: [{ code: "4" }] });
    expect(await collectDashboardData({ clientId, from: "2025-09-01", to: "2025-09-30" })).toMatchObject({ error: expect.stringContaining("3 lotes concluídos"), insightCount: 42 });
    expect(mocks.revalidate).toHaveBeenCalledWith(`/cliente/${clientId}`);
  });
});
