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

it("omits paused and unconfirmed campaigns from the live catalog when they have no period spend", async () => {
  mocks.statuses.mockImplementation(async (_input, _thumbs, catalog) => {
    catalog.push({ accountId, id: "2", name: "Live paused campaign" },
      { accountId, id: "3", name: "Live unknown campaign" },
      { accountId, id: "4", name: "Live active campaign" });
    return { [`${accountId}:campaign:2`]: "PAUSED", [`${accountId}:campaign:4`]: "ACTIVE" };
  });
  const result = await getClientAnalyticsHierarchy(input);
  expect(result).toMatchObject({ entities: [{ id: "1", effectiveStatus: null, values: { spend: 100 } },
    { id: "4", effectiveStatus: "ACTIVE", values: {} }] });
});

it.each(["empty", "throws"])("keeps only spent campaigns when live confirmation %s", async (failure) => {
  mocks.rpc.mockResolvedValue({ data: [
    { key: "campaign:1", id: "1", level: "campaign", accountId, name: "Spent", effectiveStatus: "ACTIVE", values: { spend: 0.01 } },
    { key: "campaign:2", id: "2", level: "campaign", accountId, name: "Zero spend", effectiveStatus: "ACTIVE", values: { spend: 0, impressions: 100 } },
    { key: "campaign:3", id: "3", level: "campaign", accountId, name: "Unknown spend", effectiveStatus: "ACTIVE", values: {} },
    { key: "adset:21", id: "21", level: "adset", accountId, name: "Hidden descendant", parentId: "2", campaignId: "2", values: { spend: 5 } },
  ] });
  if (failure === "throws") mocks.statuses.mockRejectedValue(new Error("Unavailable"));
  else mocks.statuses.mockResolvedValue({});
  const result = await getClientAnalyticsHierarchy(input);
  expect(result).toMatchObject({ entities: [{ id: "1", effectiveStatus: null, values: { spend: 0.01 } }] });
});

it("uses only spend returned for the requested dates and leaves live campaigns visible in both periods", async () => {
  mocks.statuses.mockImplementation(async (_input, _thumbs, catalog) => {
    catalog.push({ accountId, id: "3", name: "Always live" });
    return { [`${accountId}:campaign:3`]: "ACTIVE" };
  });
  mocks.rpc.mockImplementation(async (_name, parameters) => ({ data: [
    { key: "campaign:1", id: "1", level: "campaign", accountId, name: "Historical", values: { spend: parameters.p_date_from === input.dateFrom ? 20 : 0 } },
    { key: "campaign:2", id: "2", level: "campaign", accountId, name: "Other period", values: { spend: parameters.p_date_from === input.dateFrom ? 0 : 10 } },
  ] }));
  const current = await getClientAnalyticsHierarchy(input);
  const olderInput = { ...input, dateFrom: "2026-08-01", dateTo: "2026-08-31" };
  const older = await getClientAnalyticsHierarchy(olderInput);
  expect(current).toMatchObject({ entities: [{ id: "1" }, { id: "3", effectiveStatus: "ACTIVE" }] });
  expect(older).toMatchObject({ entities: [{ id: "2" }, { id: "3", effectiveStatus: "ACTIVE" }] });
  expect(mocks.rpc).toHaveBeenLastCalledWith("get_client_analytics_hierarchy", {
    p_client_id: olderInput.clientId, p_date_from: olderInput.dateFrom, p_date_to: olderInput.dateTo, p_ad_account_ids: olderInput.accountIds,
  });
});
