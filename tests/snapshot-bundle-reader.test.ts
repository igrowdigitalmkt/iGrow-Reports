import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";
vi.mock("server-only", () => ({}));
import { readConfirmedSnapshotBundle } from "@/modules/integrations/snapshot-bundle-reader";

const identity: CollectionIdentity = { clientId: "c", connectionId: "i", provider: "meta", externalAccountId: "act_1", dateFrom: "2026-10-01", dateTo: "2026-10-03", level: "account", apiVersion: "v24.0", contractVersion: 3 };
const scopes = [identity, { ...identity, externalAccountId: "act_2" }];
const now = Date.parse("2026-10-04T12:00:00Z");
const snapshot = (collectedAt = "2026-10-04T11:59:00Z") => ({ snapshotId: "s", collectedAt, metrics: [] });
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient<Database>;

it("withholds every scope when one account has no confirmed snapshot", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: snapshot(), error: null }).mockResolvedValueOnce({ data: null, error: null });
  expect(await readConfirmedSnapshotBundle(client(rpc), scopes, now)).toEqual({ status: "pending", scopes: [], missing: [scopes[1]], collectedAt: null });
});
it("releases all scopes together, including confirmed empty collections", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: snapshot(), error: null });
  const result = await readConfirmedSnapshotBundle(client(rpc), scopes, now);
  expect(result.status).toBe("ready");
  expect(result.scopes.map(scope => scope.identity.externalAccountId)).toEqual(["act_1", "act_2"]);
  expect(result.scopes.every(scope => scope.snapshot.entities.length === 0)).toBe(true);
  expect(rpc.mock.calls[1][1]).toMatchObject({ p_client_id: "c", p_connection_id: "i", p_external_account_id: "act_2", p_contract_version: 3 });
});
it("retains confirmed history with the oldest collection time and stale status", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: snapshot(), error: null })
    .mockResolvedValueOnce({ data: snapshot("2026-10-04T10:00:00Z"), error: null });
  expect(await readConfirmedSnapshotBundle(client(rpc), scopes, now)).toMatchObject({ status: "stale", collectedAt: "2026-10-04T10:00:00Z" });
});
it("propagates denied reads without releasing partial data", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: snapshot(), error: null }).mockResolvedValueOnce({ data: null, error: { message: "denied" } });
  await expect(readConfirmedSnapshotBundle(client(rpc), scopes, now)).rejects.toThrow("Não foi possível consultar");
});
it("does not release a bundle containing an invalid snapshot", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: snapshot(), error: null })
    .mockResolvedValueOnce({ data: { ...snapshot(), collectedAt: "invalid" }, error: null });
  await expect(readConfirmedSnapshotBundle(client(rpc), scopes, now)).rejects.toThrow();
});
it.each(["clientId", "connectionId", "provider", "dateFrom", "dateTo", "apiVersion", "contractVersion"])("rejects mixed %s before reading", async key => {
  const rpc = vi.fn();
  const foreign = { ...scopes[1], [key]: key === "contractVersion" ? 2 : "foreign" } as CollectionIdentity;
  await expect(readConfirmedSnapshotBundle(client(rpc), [identity, foreign], now)).rejects.toThrow("incompatíveis");
  expect(rpc).not.toHaveBeenCalled();
});
it("rejects duplicate or empty selections before reading", async () => {
  const rpc = vi.fn();
  await expect(readConfirmedSnapshotBundle(client(rpc), [], now)).rejects.toThrow("inválida");
  await expect(readConfirmedSnapshotBundle(client(rpc), [identity, identity], now)).rejects.toThrow("duplicado");
  expect(rpc).not.toHaveBeenCalled();
});
it("keeps account and campaign snapshots separate without adding their totals", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: snapshot(), error: null });
  const result = await readConfirmedSnapshotBundle(client(rpc), [identity, { ...identity, level: "campaign" }], now);
  expect(result.scopes.map(scope => scope.identity.level)).toEqual(["account", "campaign"]);
});
