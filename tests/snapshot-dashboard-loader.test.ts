import { beforeEach,expect,it,vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
vi.mock("server-only",() => ({}));
vi.mock("@/lib/env",() => ({ getMetaApiConfig: () => ({ apiVersion: "v24.0" }) }));
import { loadSnapshotDashboard,resolveSnapshotDashboardSelection } from "@/modules/client-portal/snapshot-dashboard-loader";
const clientId = "11111111-0000-4000-8000-000000000001";
const account = { id: "50000000-0000-4000-8000-000000000001",connection_id: "40000000-0000-4000-8000-000000000001",external_id: "act_1",name: "Conta A",currency: "BRL",timezone_name: "America/Sao_Paulo" };
const query = { periodo: "custom",from: "2026-10-01",to: "2026-10-03" };
const now = new Date("2026-10-04T12:00:00Z");
let missing = "";
let campaignSpend = "100";
let badCurrency = false;
let orphan = false;
let empty = false;
let adsetSpend = "100";
let adSpend = "100";
let missingChildren = false;
function rpcMock() {
  return vi.fn(async (name: string,args: Record<string,string>) => {
    if (name === "list_client_snapshot_accounts") return { data: [account],error: null };
    const level = args.p_entity_level;
    if (missing === level) return { data: null,error: null };
    const id = level === "account" ? "act_1" : level === "campaign" ? "123" : level === "adset" ? "456" : "789";
    const metadata = level === "account" ? { name: "Conta A",parentId: null,campaignId: null,adsetId: null }
      : level === "campaign" ? { name: "Campanha",parentId: "act_1",campaignId: "123",adsetId: null }
        : level === "adset" ? { name: "Conjunto",parentId: orphan ? "999" : "123",campaignId: orphan ? "999" : "123",adsetId: "456" }
          : { name: "Anúncio",parentId: "456",campaignId: "123",adsetId: "456" };
    const value = level === "campaign" ? campaignSpend : level === "adset" ? adsetSpend : level === "ad" ? adSpend : "100";
    const metrics = empty || missingChildren && (level === "adset" || level === "ad") ? [] : [{
      clientId,connectionId: account.connection_id,provider: "meta",externalAccountId: "act_1",externalEntityId: id,
      level,dateFrom: query.from,dateTo: query.to,timezone: account.timezone_name,currency: badCurrency ? "USD" : "BRL",
      nativeKey: "spend",value,state: "available",mappingVersion: 3,unit: "currency",aggregationRule: "sum",entity: metadata,
    }];
    return { data: { snapshotId: `s-${level}`,collectedAt: now.toISOString(),metrics },error: null };
  });
}
const client = (rpc: ReturnType<typeof rpcMock>) => ({ rpc }) as unknown as SupabaseClient<Database>;
beforeEach(() => { missing = ""; campaignSpend = "100"; adsetSpend = "100"; adSpend = "100"; missingChildren = false; badCurrency = false; orphan = false; empty = false; });
it("loads only authenticated snapshots for every selected level without collecting from Meta",async () => {
  const rpc = rpcMock();
  const data = await loadSnapshotDashboard(client(rpc),clientId,query,now);
  expect(data.view.status).toBe("ready"); expect(data.blockedReason).toBeNull();
  expect(data.view.scopes).toHaveLength(4);
  expect(rpc.mock.calls[0]).toEqual(["list_client_snapshot_accounts",{ p_client_id: clientId }]);
  expect(rpc.mock.calls.slice(1).every(([name,args]) => name === "get_confirmed_collection_snapshot" && args.p_client_id === clientId && args.p_connection_id === account.connection_id)).toBe(true);
});
it("hides all scopes when one required level is missing",async () => {
  missing = "ad";
  const data = await loadSnapshotDashboard(client(rpcMock()),clientId,query,now);
  expect(data).toMatchObject({ blockedReason: "missing",view: { status: "pending",scopes: [] } });
});
it("hides contradictory account/campaign spend",async () => {
  campaignSpend = "200";
  expect(await loadSnapshotDashboard(client(rpcMock()),clientId,query,now)).toMatchObject({ blockedReason: "spend",view: { scopes: [] } });
});
it.each(["adset","ad"])("hides the full analysis when %s spend contradicts its parent",async level => {
  if (level === "adset") adsetSpend = "200"; else adSpend = "200";
  expect(await loadSnapshotDashboard(client(rpcMock()),clientId,query,now)).toMatchObject({ blockedReason: "spend",view: { scopes: [] } });
});
it("does not accept positive-spend campaigns with confirmed empty descendants",async () => {
  missingChildren = true;
  expect(await loadSnapshotDashboard(client(rpcMock()),clientId,query,now)).toMatchObject({ blockedReason: "spend",view: { scopes: [] } });
});
it("resolves refresh identities from the catalog without reading unhealthy snapshots",async () => {
  const rpc = rpcMock(); badCurrency = true;
  const selection = await resolveSnapshotDashboardSelection(client(rpc),clientId,query,now);
  expect(selection.identities.map(identity => identity.level)).toEqual(["account","campaign","adset","ad"]);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("accepts decimal rounding within reconciliation tolerance",async () => {
  campaignSpend = "100.004";
  expect((await loadSnapshotDashboard(client(rpcMock()),clientId,query,now)).view.status).toBe("ready");
});
it("hides orphaned hierarchy even when spend matches",async () => {
  orphan = true;
  expect(await loadSnapshotDashboard(client(rpcMock()),clientId,query,now)).toMatchObject({ blockedReason: "hierarchy",view: { scopes: [] } });
});
it("withholds invalid currency metadata while keeping the operator able to request repair",async () => {
  badCurrency = true;
  expect(await loadSnapshotDashboard(client(rpcMock()),clientId,query,now)).toMatchObject({ blockedReason: "invalid",view: { scopes: [] } });
});
it("withholds malformed stored snapshots without disguising them as missing",async () => {
  const rpc = rpcMock(); const original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name,args) => name === "get_confirmed_collection_snapshot"
    ? { data: { snapshotId: "invalid",collectedAt: "bad",metrics: [] },error: null } as never : original(name,args));
  expect(await loadSnapshotDashboard(client(rpc),clientId,query,now)).toMatchObject({ blockedReason: "invalid",view: { missing: [],scopes: [] } });
});
it("does not turn snapshot access denial or database outages into a recoverable metric failure",async () => {
  const rpc = rpcMock(); const original = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name,args) => name === "get_confirmed_collection_snapshot"
    ? { data: null,error: { message: "denied" } } as never : original(name,args));
  await expect(loadSnapshotDashboard(client(rpc),clientId,query,now)).rejects.toThrow("Não foi possível consultar");
});
it("does not replace complete empty collections with invented metrics",async () => {
  empty = true;
  const data = await loadSnapshotDashboard(client(rpcMock()),clientId,query,now);
  expect(data.view.status).toBe("ready");
  expect(data.view.scopes.every(scope => scope.entities.length === 0)).toBe(true);
});
it("rejects foreign account filters before reading snapshots",async () => {
  const rpc = rpcMock();
  await expect(loadSnapshotDashboard(client(rpc),clientId,{ ...query,accounts: "50000000-0000-4000-8000-000000000099" },now)).rejects.toThrow("fora do escopo");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("rejects duplicated account filters",async () => {
  await expect(loadSnapshotDashboard(client(rpcMock()),clientId,{ ...query,accounts: `${account.id},${account.id}` },now)).rejects.toThrow("fora do escopo");
});
it("does not read snapshots for a client without accounts",async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [],error: null });
  expect(await loadSnapshotDashboard(client(rpc),clientId,query,now)).toMatchObject({ blockedReason: "no_accounts",view: { scopes: [] } });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("propagates a denied account catalog rather than treating it as empty",async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null,error: { message: "denied" } });
  await expect(loadSnapshotDashboard(client(rpc),clientId,query,now)).rejects.toThrow("contas autorizadas");
});
