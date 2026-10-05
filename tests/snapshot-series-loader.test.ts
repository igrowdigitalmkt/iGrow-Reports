import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getMetaApiConfig: () => ({ apiVersion: "v24.0" }) }));
import { loadSnapshotSeries, resolveSeriesMissingIdentities } from "@/modules/client-portal/snapshot-series-loader";
import { enqueueDailyCollectionJobs } from "@/modules/integrations/repository";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";

const clientId = "11111111-0000-4000-8000-000000000001";
const accountId = "50000000-0000-4000-8000-000000000001";
const account = {
  id: accountId, connection_id: "40000000-0000-4000-8000-000000000001",
  external_id: "act_1", name: "Conta A", currency: "BRL", timezone_name: "America/Sao_Paulo",
};
const now = new Date("2026-10-05T12:00:00Z");

let missingDates: string[] = [];
let emptyDates: string[] = [];
let overrides: Record<string, Record<string, unknown>> = {};

function makeMetric(date: string) {
  return {
    clientId, connectionId: account.connection_id, provider: "meta",
    externalAccountId: "act_1", externalEntityId: "act_1",
    level: "account", dateFrom: date, dateTo: date,
    timezone: "America/Sao_Paulo", currency: "BRL",
    nativeKey: "spend", value: "150.00", state: "available",
    mappingVersion: 3, unit: "currency", aggregationRule: "sum",
    entity: { name: "Conta A", parentId: null, campaignId: null, adsetId: null },
  };
}

function rpcMock() {
  return vi.fn(async (name: string, args: Record<string, string>) => {
    if (name === "list_client_snapshot_accounts") return { data: [account], error: null };
    if (name === "get_confirmed_collection_snapshot") {
      const date = args.p_date_from;
      if (missingDates.includes(date)) return { data: null, error: null };
      const metrics = emptyDates.includes(date) ? [] : [{ ...makeMetric(date), ...overrides[date] }];
      return { data: { snapshotId: `s-${date}`, collectedAt: now.toISOString(), metrics }, error: null };
    }
    return { data: null, error: null };
  });
}

const client = (rpc: ReturnType<typeof rpcMock>) => ({ rpc }) as unknown as SupabaseClient<Database>;

beforeEach(() => { missingDates = []; emptyDates = []; overrides = {}; });

it("loads a daily series with one point per day", async () => {
  const rpc = rpcMock();
  const result = await loadSnapshotSeries(client(rpc), clientId, accountId, "2026-10-01", "2026-10-03", now);
  expect(result.points).toHaveLength(3);
  expect(result.points[0].date).toBe("2026-10-01");
  expect(result.points[2].date).toBe("2026-10-03");
  expect(result.missingDates).toHaveLength(0);
  expect(result.keys).toContain("spend");
  expect(result.currency).toBe("BRL");
  expect(result.timezone).toBe("America/Sao_Paulo");
  expect(result.units["spend"]).toBe("currency");
  expect(result.accountName).toBe("Conta A");
  expect(result.complete).toBe(true);
  expect(result.points.every(p => p.status === "ready")).toBe(true);
});

it("marks missing days and withholds the chart until coverage is complete", async () => {
  missingDates = ["2026-10-02"];
  const rpc = rpcMock();
  const result = await loadSnapshotSeries(client(rpc), clientId, accountId, "2026-10-01", "2026-10-03", now);
  expect(result.points).toHaveLength(3);
  expect(result.points.map(p => p.status)).toEqual(["ready", "missing", "ready"]);
  expect(result.points[1].values).toEqual({});
  expect(result.missingDates).toEqual(["2026-10-02"]);
  expect(result.complete).toBe(false);
});

it("returns all missing when no day is confirmed", async () => {
  missingDates = ["2026-10-01", "2026-10-02", "2026-10-03"];
  const rpc = rpcMock();
  const result = await loadSnapshotSeries(client(rpc), clientId, accountId, "2026-10-01", "2026-10-03", now);
  expect(result.points.every(p => p.status === "missing")).toBe(true);
  expect(result.missingDates).toHaveLength(3);
  expect(result.keys).toHaveLength(0);
});

it("rejects a non-member account", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: [account], error: null });
  await expect(
    loadSnapshotSeries(client(rpc as never), clientId, "99999999-0000-4000-8000-000000000001", "2026-10-01", "2026-10-01", now)
  ).rejects.toThrow("Conta não autorizada");
});

it("throws CollectionSchemaUnavailableError when catalog RPC signals schema mismatch", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "schema" } });
  await expect(
    loadSnapshotSeries(client(rpc as never), clientId, accountId, "2026-10-01", "2026-10-01", now)
  ).rejects.toBeInstanceOf(CollectionSchemaUnavailableError);
});

it("rejects a period exceeding 90 days", async () => {
  const rpc = rpcMock();
  await expect(
    loadSnapshotSeries(client(rpc), clientId, accountId, "2026-01-01", "2026-04-15", now)
  ).rejects.toThrow("90 dias");
});

it("keeps a confirmed empty collection distinct from a missing day", async () => {
  emptyDates = ["2026-10-02"];
  const result = await loadSnapshotSeries(client(rpcMock()), clientId, accountId, "2026-10-01", "2026-10-03", now);
  expect(result.points[1]).toMatchObject({ status: "empty", values: {} });
  expect(result.missingDates).toEqual([]);
  expect(result.complete).toBe(true);
});

it("treats currency or timezone drift as invalid and blocks the chart", async () => {
  overrides = { "2026-10-02": { currency: "USD" }, "2026-10-03": { timezone: "UTC" } };
  const result = await loadSnapshotSeries(client(rpcMock()), clientId, accountId, "2026-10-01", "2026-10-03", now);
  expect(result.points.map(p => p.status)).toEqual(["ready", "invalid", "invalid"]);
  expect(result.invalidDates).toEqual(["2026-10-02", "2026-10-03"]);
  expect(result.complete).toBe(false);
});

it("treats an unreadable snapshot as invalid, not missing", async () => {
  overrides = { "2026-10-02": { value: 150 } };
  const result = await loadSnapshotSeries(client(rpcMock()), clientId, accountId, "2026-10-01", "2026-10-02", now);
  expect(result.points[1].status).toBe("invalid");
  expect(result.missingDates).toEqual([]);
});

it("excludes indicators whose unit changes across days", async () => {
  overrides = { "2026-10-02": { unit: "count" } };
  const result = await loadSnapshotSeries(client(rpcMock()), clientId, accountId, "2026-10-01", "2026-10-02", now);
  expect(result.keys).not.toContain("spend");
  expect(result.units).toEqual({});
});

it("rejects an inverted period", async () => {
  await expect(loadSnapshotSeries(client(rpcMock()), clientId, accountId, "2026-10-03", "2026-10-01", now)).rejects.toThrow("Período inválido");
});

it("resolves identities only for missing days, one per day at account level", async () => {
  missingDates = ["2026-10-01", "2026-10-03"];
  emptyDates = ["2026-10-02"];
  const rpc = rpcMock();
  const identities = await resolveSeriesMissingIdentities(client(rpc), clientId, accountId, "2026-10-01", "2026-10-03", now);
  expect(identities).toHaveLength(2);
  expect(identities.every(id => id.level === "account")).toBe(true);
  expect(identities[0].dateFrom).toBe("2026-10-01");
  expect(identities[0].dateTo).toBe("2026-10-01");
  expect(identities[1].dateFrom).toBe("2026-10-03");
  expect(identities[0].externalAccountId).toBe("act_1");
  expect(identities[0].clientId).toBe(clientId);
  expect(identities[0].contractVersion).toBe(3);
});

it("points carry decimal values verbatim without rounding", async () => {
  const rpc = vi.fn(async (name: string, args: Record<string, string>) => {
    if (name === "list_client_snapshot_accounts") return { data: [account], error: null };
    return {
      data: {
        snapshotId: "s-x", collectedAt: now.toISOString(),
        metrics: [{ ...makeMetric(args.p_date_from), value: "12345.6789" }],
      }, error: null,
    };
  });
  const result = await loadSnapshotSeries(client(rpc as never), clientId, accountId, "2026-10-01", "2026-10-01", now);
  expect(result.points[0].values["spend"]).toBe("12345.6789");
});

it("enqueues daily identities with distinct dates in one request", async () => {
  missingDates = ["2026-10-01", "2026-10-02"];
  const identities = await resolveSeriesMissingIdentities(client(rpcMock()), clientId, accountId, "2026-10-01", "2026-10-02", now);
  const upsert = vi.fn(() => ({ select: async () => ({ data: [{ id: "a" }, { id: "b" }], error: null }) }));
  const service = { from: vi.fn(() => ({ upsert })) } as unknown as SupabaseClient<Database>;
  await expect(enqueueDailyCollectionJobs(service, identities)).resolves.toBe(2);
  const rows = (upsert.mock.calls[0] as unknown as [Array<{ date_from: string; date_to: string }>])[0];
  expect(rows.map(row => [row.date_from, row.date_to])).toEqual([["2026-10-01", "2026-10-01"], ["2026-10-02", "2026-10-02"]]);
  await expect(enqueueDailyCollectionJobs(service, [{ ...identities[0], dateTo: "2026-10-02" }])).rejects.toThrow("incompatíveis");
  await expect(enqueueDailyCollectionJobs(service, [identities[0], { ...identities[1], externalAccountId: "act_2" }])).rejects.toThrow("incompatíveis");
});
