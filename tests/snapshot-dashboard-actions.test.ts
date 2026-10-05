import { beforeEach,expect,it,vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(),load: vi.fn(),selection: vi.fn(),service: vi.fn(),enqueue: vi.fn(),refresh: vi.fn(),revalidate: vi.fn() }));
vi.mock("next/cache",() => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/modules/client-portal/context",() => ({ requireClientDashboardAccess: mocks.access }));
vi.mock("@/modules/client-portal/snapshot-dashboard-loader",() => ({ loadSnapshotDashboard: mocks.load,resolveSnapshotDashboardSelection: mocks.selection }));
vi.mock("@/lib/supabase/service",() => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/integrations/repository",() => ({ enqueueCollectionJobs: mocks.enqueue,requestMetaCollectionRefresh: mocks.refresh }));
vi.mock("@/lib/env",() => ({ getMetaApiConfig: () => ({ apiVersion: "v24.0" }) }));
import { requestMissingSnapshotData } from "@/modules/client-portal/snapshot-dashboard-actions";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";
const input = { clientId: "11111111-0000-4000-8000-000000000001",from: "2026-10-01",to: "2026-10-03",accountIds: ["50000000-0000-4000-8000-000000000001"] };
const identity = { clientId: input.clientId,connectionId: "authorized",externalAccountId: "act_1",provider: "meta",level: "ad",dateFrom: input.from,dateTo: input.to,apiVersion: "v24.0",contractVersion: 3 };
it("derives previous dates on the server and reauthorizes the refresh scope",async () => {
  const selection = { accounts: [{ id: input.accountIds[0],timezone_name: "America/Sao_Paulo" }],selectedAccountIds: input.accountIds,identities: [identity] };
  mocks.selection.mockResolvedValueOnce(selection).mockResolvedValueOnce({ ...selection,identities: [{ ...identity,dateFrom: "2026-09-28",dateTo: "2026-09-30" }] });
  expect(await requestMissingSnapshotData({ ...input,target: "previous",refresh: true })).toEqual({ success: true,created: 4 });
  expect(mocks.selection).toHaveBeenNthCalledWith(2,"session",input.clientId,{ periodo: "custom",from: "2026-09-28",to: "2026-09-30",accounts: input.accountIds.join(",") });
  expect(mocks.refresh).toHaveBeenCalledWith("service",[expect.objectContaining({ connectionId: "authorized",dateFrom: "2026-09-28",dateTo: "2026-09-30" })]);
});
it("blocks previous-period writes if its second authorization fails",async () => {
  mocks.selection.mockResolvedValueOnce({ accounts: [{ id: input.accountIds[0],timezone_name: "America/Sao_Paulo" }],selectedAccountIds: input.accountIds }).mockRejectedValueOnce(new Error("revoked"));
  expect(await requestMissingSnapshotData({ ...input,target: "previous",refresh: true })).toHaveProperty("error");
  expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.access.mockResolvedValue({ canCollect: true,supabase: "session" });
  mocks.load.mockResolvedValue({ view: { missing: [identity] },blockedReason: "missing" });
  mocks.service.mockReturnValue("service"); mocks.enqueue.mockResolvedValue(1);
  mocks.refresh.mockResolvedValue({ created: 0,rescheduled: 4,preserved: 0 });
  mocks.selection.mockResolvedValue({ identities: ["account","campaign","adset","ad"].map(level => ({ ...identity,level })) });
});
it("refreshes all authorized levels even when older confirmed data exists",async () => {
  mocks.load.mockResolvedValue({ view: { missing: [] },blockedReason: null,accounts: [{ id: input.accountIds[0],connection_id: "authorized",external_id: "act_1" }],selectedAccountIds: input.accountIds,dateFrom: input.from,dateTo: input.to });
  expect(await requestMissingSnapshotData({ ...input,refresh: true })).toEqual({ success: true,created: 4 });
  expect(mocks.refresh).toHaveBeenCalledWith("service",expect.arrayContaining([expect.objectContaining({ clientId: input.clientId,connectionId: "authorized",externalAccountId: "act_1",level: "account",contractVersion: 3 })]));
  expect(mocks.refresh.mock.calls[0][1].map((scope: { level: string }) => scope.level)).toEqual(["account","campaign","adset","ad"]);
  expect(mocks.enqueue).not.toHaveBeenCalled();
  expect(mocks.load).not.toHaveBeenCalled();
});
it("can request repair when snapshot reads would fail",async () => {
  mocks.load.mockRejectedValue(new Error("invalid snapshot"));
  expect(await requestMissingSnapshotData({ ...input,refresh: true })).toEqual({ success: true,created: 4 });
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.selection).toHaveBeenCalledWith("session",input.clientId,expect.objectContaining({ accounts: input.accountIds.join(",") }));
});
it("returns a setup message without privileged writes when catalog is missing",async () => {
  mocks.selection.mockRejectedValue(new CollectionSchemaUnavailableError());
  const result = await requestMissingSnapshotData({ ...input,refresh: true });
  expect(result).toEqual({ error: new CollectionSchemaUnavailableError().message });
  expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("does not report successful queueing when the refresh RPC is missing",async () => {
  mocks.refresh.mockRejectedValue(new CollectionSchemaUnavailableError());
  expect(await requestMissingSnapshotData({ ...input,refresh: true })).toEqual({ error: new CollectionSchemaUnavailableError().message });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("does not use service credentials when refresh scope authorization fails",async () => {
  mocks.selection.mockRejectedValue(new Error("foreign account"));
  expect(await requestMissingSnapshotData({ ...input,refresh: true })).toHaveProperty("error");
  expect(mocks.service).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
});
it("registers only missing identities resolved from authenticated reads",async () => {
  expect(await requestMissingSnapshotData({ ...input,connectionId: "foreign",contractVersion: 1 })).toEqual({ success: true,created: 1 });
  expect(mocks.load).toHaveBeenCalledWith("session",input.clientId,{ periodo: "custom",from: input.from,to: input.to,accounts: input.accountIds.join(",") });
  expect(mocks.enqueue).toHaveBeenCalledWith("service",[identity]);
  expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.service.mock.invocationCallOrder[0]);
  expect(mocks.revalidate).toHaveBeenCalledWith(`/cliente/${input.clientId}/snapshots`);
});
it("blocks client/viewer/archived access before privileged work",async () => {
  mocks.access.mockResolvedValue({ canCollect: false });
  expect(await requestMissingSnapshotData(input)).toHaveProperty("error");
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.service).not.toHaveBeenCalled();
});
it("rejects invalid input before authorization or enqueue",async () => {
  expect(await requestMissingSnapshotData({ ...input,accountIds: [] })).toHaveProperty("error");
  expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("does not enqueue again when every snapshot is already confirmed",async () => {
  mocks.load.mockResolvedValue({ view: { missing: [] },blockedReason: null });
  expect(await requestMissingSnapshotData(input)).toHaveProperty("error");
  expect(mocks.service).not.toHaveBeenCalled();
});
it("does not bypass failed reconciliation by registering more jobs",async () => {
  mocks.load.mockResolvedValue({ view: { missing: [] },blockedReason: "spend" });
  expect(await requestMissingSnapshotData(input)).toHaveProperty("error");
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("sanitizes rejected account/queue errors",async () => {
  mocks.load.mockRejectedValue(new Error("secret access_token"));
  expect(JSON.stringify(await requestMissingSnapshotData(input))).not.toContain("secret");
  expect(mocks.service).not.toHaveBeenCalled();
  mocks.load.mockResolvedValue({ view: { missing: [identity] },blockedReason: "missing" });
  mocks.enqueue.mockRejectedValue(new Error("secret database detail"));
  expect(JSON.stringify(await requestMissingSnapshotData(input))).not.toContain("secret");
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("preserves idempotent requests and handles missing service configuration",async () => {
  mocks.enqueue.mockResolvedValue(0);
  expect(await requestMissingSnapshotData(input)).toEqual({ success: true,created: 0 });
  mocks.service.mockReturnValue(null);
  expect(await requestMissingSnapshotData(input)).toHaveProperty("error");
});
