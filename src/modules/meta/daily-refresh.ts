import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { collectMetaClientInsights } from "./server";

// Revision window for Meta daily rows (decision of 5/10/2026, PLANEJAMENTO_V1
// addendum): the last 7 days change every day (7-day click attribution, late
// conversions); days 8–28 can still be revised (delayed events, billing and
// invalid-traffic adjustments) and are revisited weekly; older days are frozen.
export const META_DAILY_WINDOW_DAYS = 7;
export const META_WEEKLY_WINDOW_DAYS = 28;
const REFRESH_TIMEZONE = "America/Sao_Paulo";

function localDate(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function shift(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export type RefreshWindow = { since: string; until: string; kind: "daily" | "weekly" };

// Complete days only: the window ends yesterday in the agency's time zone.
export function planMetaRefreshWindows(now: Date, timeZone = REFRESH_TIMEZONE): RefreshWindow[] {
  const yesterday = shift(localDate(now, timeZone), -1);
  const windows: RefreshWindow[] = [{ since: shift(yesterday, 1 - META_DAILY_WINDOW_DAYS), until: yesterday, kind: "daily" }];
  const weekday = new Date(`${localDate(now, timeZone)}T12:00:00Z`).getUTCDay();
  if (weekday === 1) {
    windows.push({ since: shift(yesterday, 1 - META_WEEKLY_WINDOW_DAYS), until: shift(yesterday, -META_DAILY_WINDOW_DAYS), kind: "weekly" });
  }
  return windows;
}

export type DailyRefreshResult = {
  clients: number;
  refreshed: number;
  failed: number;
  skippedByBudget: number;
  windows: RefreshWindow[];
};

// Refreshes every active client with a Meta connection and linked accounts,
// least recently refreshed first, until the time budget is spent. Clients left
// over are first in line on the next run; a missing day is also collected when
// someone opens the dashboard.
export async function runDailyMetaRefresh(service: SupabaseClient<Database>, options: { now?: Date; budgetMs: number }): Promise<DailyRefreshResult> {
  const started = performance.now();
  const windows = planMetaRefreshWindows(options.now ?? new Date());
  const { data: connections, error } = await service.from("meta_connections")
    .select("agency_id,client_id")
    .not("client_id", "is", null);
  if (error) throw new Error("Não foi possível listar os clientes conectados à Meta.");
  const { data: links, error: linkError } = await service.from("client_ad_accounts").select("agency_id,client_id").eq("active", true);
  if (linkError) throw new Error("Não foi possível listar as contas vinculadas.");
  const { data: archived, error: archivedError } = await service.from("clients").select("id").not("archived_at", "is", null);
  if (archivedError) throw new Error("Não foi possível listar os clientes.");
  const linked = new Set((links ?? []).map(link => `${link.agency_id}:${link.client_id}`));
  const inactive = new Set((archived ?? []).map(client => client.id));
  const seen = new Set<string>();
  const targets = (connections ?? []).filter(connection => {
    const key = `${connection.agency_id}:${connection.client_id}`;
    if (!connection.client_id || inactive.has(connection.client_id) || !linked.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const { data: recent } = await service.from("audit_logs").select("entity_id,created_at")
    .eq("action", "meta.insights_collected").order("created_at", { ascending: false }).limit(500);
  const lastRun = new Map<string, string>();
  for (const row of recent ?? []) if (row.entity_id && !lastRun.has(row.entity_id)) lastRun.set(row.entity_id, row.created_at);
  targets.sort((a, b) => (lastRun.get(a.client_id!) ?? "").localeCompare(lastRun.get(b.client_id!) ?? ""));

  const result: DailyRefreshResult = { clients: targets.length, refreshed: 0, failed: 0, skippedByBudget: 0, windows };
  for (const target of targets) {
    if (performance.now() - started >= options.budgetMs) { result.skippedByBudget += 1; continue; }
    try {
      let failures = 0;
      for (const window of windows) {
        const collected = await collectMetaClientInsights({ agencyId: target.agency_id, clientId: target.client_id!, actorId: null,
          since: window.since, until: window.until });
        failures += collected.failures.length;
      }
      if (failures) result.failed += 1; else result.refreshed += 1;
    } catch (failure) {
      result.failed += 1;
      console.error("meta-daily-refresh-client-failed", { clientId: target.client_id, name: failure instanceof Error ? failure.name : "unknown" });
    }
  }
  return result;
}
