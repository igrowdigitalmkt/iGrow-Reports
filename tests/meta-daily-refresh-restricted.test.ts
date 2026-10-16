import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const mocks = vi.hoisted(() => ({ collect: vi.fn(), refreshScope: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ collectMetaClientInsights: mocks.collect, refreshMetaDashboardScope: mocks.refreshScope }));
import { runDailyMetaRefresh } from "@/modules/meta/daily-refresh";

function service(tables: Record<string, unknown[]>, rpc: (name: string) => unknown) {
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const name of ["select", "not", "eq", "order", "limit"]) q[name] = () => q;
    q.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
    return q;
  };
  return { from: (table: string) => query(tables[table] ?? []), rpc: async (name: string) => rpc(name) } as unknown as SupabaseClient<Database>;
}

const tables = {
  meta_connections: [{ agency_id: "ok", client_id: "c1" }, { agency_id: "suspensa", client_id: "c2" }],
  client_ad_accounts: [{ agency_id: "ok", client_id: "c1" }, { agency_id: "suspensa", client_id: "c2" }],
  clients: [], audit_logs: [],
} as Record<string, unknown[]>;
const run = (rpc: (name: string) => unknown) => runDailyMetaRefresh(service(tables, rpc), { now: new Date("2026-10-06T09:00:00Z"), budgetMs: 60_000 });

beforeEach(() => { vi.clearAllMocks(); mocks.collect.mockResolvedValue({ failures: [] }); });

it("organizações com acesso restrito ficam fora da rodada agendada (a coleta é operação paga) e as demais seguem", async () => {
  const result = await run(name => name === "billing_restricted_agency_ids" ? { data: ["suspensa"], error: null } : { data: null, error: { code: "PGRST202" } });
  expect(result).toMatchObject({ clients: 1, refreshed: 1 });
  expect(mocks.collect.mock.calls.map(call => call[0].clientId)).toEqual(["c1"]);
});

it("sem a função no banco (migration ausente) ou com falha nada é filtrado aqui; a trava dentro da coleta continua valendo", async () => {
  expect(await run(() => ({ data: null, error: { code: "PGRST202" } }))).toMatchObject({ clients: 2 });
  expect(await run(() => { throw new Error("rede"); })).toMatchObject({ clients: 2 });
});
