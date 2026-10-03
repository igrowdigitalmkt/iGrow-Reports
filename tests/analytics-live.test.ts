import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
const mocks = vi.hoisted(() => ({ analytics: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/client-portal/analytics", () => ({ getClientAnalytics: mocks.analytics }));
vi.mock("@/modules/meta/server", () => ({ refreshMetaDashboardScope: mocks.refresh }));
import { getFreshClientAnalytics } from "@/modules/client-portal/analytics-live";
const input = { supabase: {} as SupabaseClient<Database>, agencyId: "authorized-agency", clientId: "client",
  dateFrom: "2026-07-05", dateTo: "2026-10-02", accountIds: ["authorized-account"] };
const data = (status = "complete") => ({ selectedAccountIds: input.accountIds, warnings: [],
  coverage: { status }, summary: { primary_results: null } }) as unknown as AnalyticsDashboardData;
beforeEach(() => { vi.clearAllMocks(); mocks.refresh.mockResolvedValue({ confirmed: true }); });
describe("exact period analytics", () => {
  it("loads a new full-account period from Meta before returning the refreshed aggregate", async () => {
    const initial = data(), exact = { ...data(), summary: { primary_results: 103 } };
    mocks.analytics.mockResolvedValueOnce(initial).mockResolvedValueOnce(exact);
    expect(await getFreshClientAnalytics(input)).toEqual(exact);
    expect(mocks.refresh).toHaveBeenCalledWith({ agencyId: input.agencyId, clientId: input.clientId, data: initial });
    expect(mocks.analytics).toHaveBeenCalledTimes(2);
    expect(mocks.analytics.mock.invocationCallOrder[0]).toBeLessThan(mocks.refresh.mock.invocationCallOrder[0]);
  });
  it("never queries privileged Meta data before a complete authorized RPC", async () => {
    mocks.analytics.mockResolvedValue(data("partial"));
    expect((await getFreshClientAnalytics(input)).coverage.status).toBe("partial");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("preserves unknown results and explains a failed live confirmation", async () => {
    mocks.analytics.mockResolvedValue(data()); mocks.refresh.mockRejectedValue(new Error("Meta timeout"));
    const result = await getFreshClientAnalytics(input);
    expect(result.summary.primary_results).toBeNull();
    expect(result.warnings).toContainEqual(expect.stringContaining("não confirmou"));
  });
});
