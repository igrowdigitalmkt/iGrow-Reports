import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), analytics: vi.fn(), statuses: vi.fn(), rpc: vi.fn() }));
vi.mock("@/modules/client-portal/context", () => ({ requireClientDashboardAccess: mocks.access }));
vi.mock("@/modules/client-portal/analytics", () => ({ getClientAnalytics: mocks.analytics }));
vi.mock("@/modules/meta/server", () => ({ getMetaEntityStatuses: mocks.statuses, refreshMetaDashboardScope: vi.fn() }));
import { getClientAnalyticsHierarchy } from "@/modules/client-portal/analytics-scope-actions";
const input = { clientId: "75b59204-8145-441f-91ec-4d7cc5be9109", accountIds: ["eca7861e-9817-4456-8758-432c747e45e6"], dateFrom: "2026-09-03", dateTo: "2026-10-02" };
const accountId = input.accountIds[0];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ access: { agencyId: "verified-agency" }, supabase: { rpc: mocks.rpc } });
  mocks.analytics.mockResolvedValue({ coverage: { status: "complete" }, accounts: [{ id: accountId, name: "Ronaldo Moreira", currency: "BRL" }] });
  mocks.rpc.mockResolvedValue({ data: [{ key: "campaign:1", id: "1", level: "campaign", accountId, name: "Historical", currency: "BRL", effectiveStatus: "ACTIVE", values: { spend: 100 } }] });
});
it("replaces historical ACTIVE with unknown when live status is unavailable", async () => {
  mocks.statuses.mockResolvedValue({});
  const result = await getClientAnalyticsHierarchy(input);
  expect(result).toMatchObject({ entities: [{ effectiveStatus: null }] });
});
it("fails closed on a thrown live status request", async () => {
  mocks.statuses.mockRejectedValue(new Error("Unavailable"));
  expect(await getClientAnalyticsHierarchy(input)).toMatchObject({ entities: [{ effectiveStatus: null }] });
});
it("adds live campaigns without period movement and maps statuses by account and level", async () => {
  mocks.statuses.mockImplementation(async (_input, _thumbs, catalog) => {
    catalog.push({ accountId, id: "2", name: "New live campaign" });
    return { [`${accountId}:campaign:2`]: "ACTIVE", [`other-account:campaign:1`]: "ACTIVE", [`${accountId}:ad:1`]: "ACTIVE" };
  });
  const result = await getClientAnalyticsHierarchy(input);
  expect(result).toMatchObject({ entities: [{ id: "1", effectiveStatus: null }, { id: "2", effectiveStatus: "ACTIVE", values: {} }] });
  expect(mocks.statuses.mock.calls[0][0]).toMatchObject({ agencyId: "verified-agency", clientId: input.clientId, accountIds: input.accountIds });
});
