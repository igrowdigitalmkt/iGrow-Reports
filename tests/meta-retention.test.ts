import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pruneMetaHistory } from "@/modules/meta/retention";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Call = { table: string; filters: unknown[][] };

function service() {
  const calls: Call[] = [];
  const from = (table: string) => {
    const entry: Call = { table, filters: [] };
    const q: Record<string, unknown> = {
      select: () => Promise.resolve({ data: [{ agency_id: "ag", id: "acc1" }, { agency_id: "ag", id: "acc2" }], error: null }),
      delete: () => { calls.push(entry); return q; },
      then: (resolve: (value: unknown) => void) => resolve({ count: table === "meta_daily_actions" ? 5 : 2, error: null }),
    };
    for (const name of ["eq", "in", "lt"]) q[name] = (...args: unknown[]) => { entry.filters.push([name, ...args]); return q; };
    return q;
  };
  return { db: { from } as unknown as SupabaseClient<Database>, calls };
}

it("removes only ad set and ad detail older than the retention window, account by account", async () => {
  const { db, calls } = service();
  const result = await pruneMetaHistory(db, new Date("2026-10-06T09:00:00Z"));
  expect(result).toEqual({ detailInsights: 4, detailActions: 10, aggregateScopes: 2, cutoff: "2026-04-09" });
  expect(calls.map(call => call.table)).toEqual(["meta_daily_actions", "meta_daily_insights", "meta_daily_actions", "meta_daily_insights", "meta_dashboard_scopes"]);
  for (const call of calls.slice(0, 4)) {
    expect(call.filters).toContainEqual(["in", "level", ["adset", "ad"]]);
    expect(call.filters).toContainEqual(["lt", "insight_date", "2026-04-09"]);
  }
  expect(calls[4].filters).toEqual([["lt", "collected_at", "2026-10-04T09:00:00.000Z"]]);
});
