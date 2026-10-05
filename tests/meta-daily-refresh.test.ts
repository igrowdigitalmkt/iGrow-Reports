import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ collectMetaClientInsights: mocks.collect }));
import { backfillMetaHistory, planBackfillBlock, planMetaRefreshWindows, runDailyMetaRefresh, warmStandardPeriods } from "@/modules/meta/daily-refresh";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

it("refreshes the last 7 complete days every day", () => {
  // Tuesday 06:00 in São Paulo.
  expect(planMetaRefreshWindows(new Date("2026-10-06T09:00:00Z"))).toEqual([{ since: "2026-09-29", until: "2026-10-05", kind: "daily" }]);
});

it("also revisits days 8 to 28 on Mondays", () => {
  expect(planMetaRefreshWindows(new Date("2026-10-05T09:00:00Z"))).toEqual([
    { since: "2026-09-28", until: "2026-10-04", kind: "daily" },
    { since: "2026-09-07", until: "2026-09-27", kind: "weekly" },
  ]);
});

it("uses the agency day, not UTC, to decide what yesterday is", () => {
  // 01:30 UTC on the 6th is still the 5th in São Paulo.
  expect(planMetaRefreshWindows(new Date("2026-10-06T01:30:00Z"))[0].until).toBe("2026-10-04");
});

function service(tables: Record<string, unknown[]>) {
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const name of ["select", "not", "eq", "order", "limit"]) q[name] = () => q;
    q.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return { from: (table: string) => query(tables[table] ?? []) } as unknown as SupabaseClient<Database>;
}

beforeEach(() => { vi.clearAllMocks(); mocks.collect.mockResolvedValue({ failures: [] }); });

it("refreshes active linked clients, least recently refreshed first, and skips archived or unlinked ones", async () => {
  const db = service({
    meta_connections: [{ agency_id: "a", client_id: "c1" }, { agency_id: "a", client_id: "c2" }, { agency_id: "a", client_id: "archived" }, { agency_id: "a", client_id: "unlinked" }],
    client_ad_accounts: [{ agency_id: "a", client_id: "c1" }, { agency_id: "a", client_id: "c2" }, { agency_id: "a", client_id: "archived" }],
    clients: [{ id: "archived" }],
    audit_logs: [{ entity_id: "c1", created_at: "2026-10-05T09:00:00Z" }, { entity_id: "c2", created_at: "2026-10-01T09:00:00Z" }],
  });
  const result = await runDailyMetaRefresh(db, { now: new Date("2026-10-06T09:00:00Z"), budgetMs: 60_000 });
  expect(result).toMatchObject({ clients: 2, refreshed: 2, failed: 0, skippedByBudget: 0 });
  expect(mocks.collect.mock.calls.map(call => call[0].clientId)).toEqual(["c2", "c1"]);
  expect(mocks.collect).toHaveBeenCalledWith({ agencyId: "a", clientId: "c2", actorId: null, since: "2026-09-29", until: "2026-10-05" });
});

it("counts failures per client and keeps going", async () => {
  mocks.collect.mockRejectedValueOnce(new Error("Meta down")).mockResolvedValueOnce({ failures: [{ code: "1" }] });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const db = service({ meta_connections: [{ agency_id: "a", client_id: "c1" }, { agency_id: "a", client_id: "c2" }], client_ad_accounts: [{ agency_id: "a", client_id: "c1" }, { agency_id: "a", client_id: "c2" }] });
  expect(await runDailyMetaRefresh(db, { now: new Date("2026-10-06T09:00:00Z"), budgetMs: 60_000 })).toMatchObject({ refreshed: 0, failed: 2 });
  log.mockRestore();
});

it("stops starting new clients when the time budget is spent", async () => {
  const db = service({ meta_connections: [{ agency_id: "a", client_id: "c1" }], client_ad_accounts: [{ agency_id: "a", client_id: "c1" }] });
  expect(await runDailyMetaRefresh(db, { now: new Date("2026-10-06T09:00:00Z"), budgetMs: 0 })).toMatchObject({ refreshed: 0, skippedByBudget: 1 });
  expect(mocks.collect).not.toHaveBeenCalled();
});


it("loads history backwards in 8-week blocks until 13 months are covered", () => {
  const now = new Date("2026-10-06T09:00:00Z"); // yesterday = 2026-10-05, target start = 2025-09-06
  expect(planBackfillBlock(["2026-09-01"], now)).toEqual({ since: "2026-07-07", until: "2026-08-31" });
  // The account with the least history decides the next block.
  expect(planBackfillBlock(["2025-10-01", "2026-09-01"], now)).toEqual({ since: "2026-07-07", until: "2026-08-31" });
  // An account without any collection starts right before today.
  expect(planBackfillBlock([null], now)).toEqual({ since: "2026-08-11", until: "2026-10-05" });
  expect(planBackfillBlock(["2025-09-20"], now)).toEqual({ since: "2025-09-06", until: "2025-09-19" });
  expect(planBackfillBlock(["2025-09-06"], now)).toBeNull();
  expect(planBackfillBlock([], now)).toBeNull();
});

function tableService(tables: Record<string, unknown[]>, rpc = vi.fn()) {
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const name of ["select", "not", "eq", "in", "order", "limit", "contains"]) q[name] = () => q;
    q.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return { from: (table: string) => query(tables[table] ?? []), rpc } as unknown as SupabaseClient<Database>;
}

it("collects the next history block per client and reports complete ones", async () => {
  const db = tableService({ client_ad_accounts: [{ ad_account_id: "acc" }], meta_collection_runs: [{ ad_account_id: "acc", date_from: "2026-09-01" }] });
  expect(await backfillMetaHistory(db, [{ agency_id: "a", client_id: "c1" }], { now: new Date("2026-10-06T09:00:00Z"), budgetMs: 60_000 }))
    .toEqual({ loaded: 1, complete: 0, failed: 0, skippedByBudget: 0 });
  expect(mocks.collect).toHaveBeenCalledWith({ agencyId: "a", clientId: "c1", actorId: null, since: "2026-07-07", until: "2026-08-31" });
  mocks.collect.mockClear();
  const done = tableService({ client_ad_accounts: [{ ad_account_id: "acc" }], meta_collection_runs: [{ ad_account_id: "acc", date_from: "2025-01-01" }] });
  expect(await backfillMetaHistory(done, [{ agency_id: "a", client_id: "c1" }], { now: new Date("2026-10-06T09:00:00Z"), budgetMs: 60_000 })).toMatchObject({ complete: 1, loaded: 0 });
  expect(mocks.collect).not.toHaveBeenCalled();
});

it("pre-computes the standard periods with the dashboard's dates for the client's accounts", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const db = tableService({ client_ad_accounts: [{ ad_account_id: "acc" }], meta_ad_accounts: [{ timezone_name: "America/Sao_Paulo", archived_at: null, business_id: "1" }] }, rpc);
  expect(await warmStandardPeriods(db, [{ agency_id: "a", client_id: "c1" }], { now: new Date("2026-10-06T09:00:00Z"), budgetMs: 60_000 }))
    .toEqual({ warmed: 5, failed: 0, skippedByBudget: 0 });
  expect(rpc).toHaveBeenNthCalledWith(1, "warm_client_analytics", { p_client_id: "c1", p_date_from: "2026-09-06", p_date_to: "2026-10-05" });
  expect(rpc).toHaveBeenNthCalledWith(5, "warm_client_analytics", { p_client_id: "c1", p_date_from: "2025-10-06", p_date_to: "2026-10-05" });
});
