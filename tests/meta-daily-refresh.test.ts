import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ collect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ collectMetaClientInsights: mocks.collect }));
import { planMetaRefreshWindows, runDailyMetaRefresh } from "@/modules/meta/daily-refresh";
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
