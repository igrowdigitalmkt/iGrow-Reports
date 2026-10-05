import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveAnalyticsRange, type AnalyticsPeriod } from "@/modules/client-portal/range";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { collectMetaClientInsights, refreshMetaDashboardScope } from "./server";

// Revision window for Meta daily rows (decision of 5/10/2026, PLANEJAMENTO_V1
// addendum): the last 7 days change every day (7-day click attribution, late
// conversions); days 8–28 can still be revised (delayed events, billing and
// invalid-traffic adjustments) and are revisited weekly; older days are frozen.
export const META_DAILY_WINDOW_DAYS = 7;
export const META_WEEKLY_WINDOW_DAYS = 28;
// History loaded for every linked account, a block per night until complete.
export const META_HISTORY_DAYS = 395;
export const META_BACKFILL_BLOCK_DAYS = 56;
// Periods offered by the dashboard, most viewed first.
export const STANDARD_PERIODS: AnalyticsPeriod[] = ["30d", "7d", "90d", "180d", "365d"];
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

// Next older block to load, given the earliest complete day of each linked
// account; null once every account reaches the history target.
export function planBackfillBlock(earliestByAccount: Array<string | null>, now: Date, timeZone = REFRESH_TIMEZONE) {
  const yesterday = shift(localDate(now, timeZone), -1);
  const target = shift(yesterday, 1 - META_HISTORY_DAYS);
  if (!earliestByAccount.length) return null;
  // The account with the least history decides; accounts already covered reuse their slices.
  const cursor = earliestByAccount.reduce<string>((latest, value) => {
    const start = value ?? shift(yesterday, 1);
    return start > latest ? start : latest;
  }, "0000-00-00");
  if (cursor <= target) return null;
  const until = shift(cursor, -1);
  const since = shift(until, 1 - META_BACKFILL_BLOCK_DAYS) < target ? target : shift(until, 1 - META_BACKFILL_BLOCK_DAYS);
  return { since, until };
}

export type MetaClientTarget = { agency_id: string; client_id: string };

// Active clients with a Meta connection and at least one active linked account,
// least recently collected first.
export async function listActiveMetaClients(service: SupabaseClient<Database>): Promise<MetaClientTarget[]> {
  const { data: connections, error } = await service.from("meta_connections").select("agency_id,client_id").not("client_id", "is", null);
  if (error) throw new Error("Não foi possível listar os clientes conectados à Meta.");
  const { data: links, error: linkError } = await service.from("client_ad_accounts").select("agency_id,client_id").eq("active", true);
  if (linkError) throw new Error("Não foi possível listar as contas vinculadas.");
  const { data: archived, error: archivedError } = await service.from("clients").select("id").not("archived_at", "is", null);
  if (archivedError) throw new Error("Não foi possível listar os clientes.");
  const linked = new Set((links ?? []).map(link => `${link.agency_id}:${link.client_id}`));
  const inactive = new Set((archived ?? []).map(client => client.id));
  const seen = new Set<string>();
  const targets: MetaClientTarget[] = [];
  for (const connection of connections ?? []) {
    const key = `${connection.agency_id}:${connection.client_id}`;
    if (!connection.client_id || inactive.has(connection.client_id) || !linked.has(key) || seen.has(key)) continue;
    seen.add(key);
    targets.push({ agency_id: connection.agency_id, client_id: connection.client_id });
  }
  const { data: recent } = await service.from("audit_logs").select("entity_id,created_at")
    .eq("action", "meta.insights_collected").order("created_at", { ascending: false }).limit(500);
  const lastRun = new Map<string, string>();
  for (const row of recent ?? []) if (row.entity_id && !lastRun.has(row.entity_id)) lastRun.set(row.entity_id, row.created_at);
  return targets.sort((a, b) => (lastRun.get(a.client_id) ?? "").localeCompare(lastRun.get(b.client_id) ?? ""));
}

export type DailyRefreshResult = {
  clients: number;
  refreshed: number;
  failed: number;
  skippedByBudget: number;
  windows: RefreshWindow[];
};

// Refreshes the revision window of every target until the time budget is spent.
// Clients left over are first in line on the next run; a missing day is also
// collected when someone opens the dashboard.
export async function runDailyMetaRefresh(service: SupabaseClient<Database>, options: { now?: Date; budgetMs: number; targets?: MetaClientTarget[] }): Promise<DailyRefreshResult> {
  const started = performance.now();
  const windows = planMetaRefreshWindows(options.now ?? new Date());
  const targets = options.targets ?? await listActiveMetaClients(service);
  const result: DailyRefreshResult = { clients: targets.length, refreshed: 0, failed: 0, skippedByBudget: 0, windows };
  for (const target of targets) {
    if (performance.now() - started >= options.budgetMs) { result.skippedByBudget += 1; continue; }
    try {
      let failures = 0;
      for (const window of windows) {
        const collected = await collectMetaClientInsights({ agencyId: target.agency_id, clientId: target.client_id, actorId: null,
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

export type BackfillResult = { loaded: number; complete: number; failed: number; skippedByBudget: number };

// Loads one older block of account/campaign history per client per run until
// META_HISTORY_DAYS are covered (ad set/ad detail stays within its retention).
export async function backfillMetaHistory(service: SupabaseClient<Database>, targets: MetaClientTarget[], options: { now?: Date; budgetMs: number }): Promise<BackfillResult> {
  const started = performance.now();
  const result: BackfillResult = { loaded: 0, complete: 0, failed: 0, skippedByBudget: 0 };
  for (const target of targets) {
    if (performance.now() - started >= options.budgetMs) { result.skippedByBudget += 1; continue; }
    try {
      const { data: links, error } = await service.from("client_ad_accounts").select("ad_account_id")
        .eq("agency_id", target.agency_id).eq("client_id", target.client_id).eq("active", true);
      if (error) throw new Error("links");
      const { data: runs, error: runError } = await service.from("meta_collection_runs").select("ad_account_id,date_from")
        .eq("agency_id", target.agency_id).eq("client_id", target.client_id).eq("status", "complete").contains("levels", ["account", "campaign"]);
      if (runError) throw new Error("runs");
      const earliest = (links ?? []).map(link => (runs ?? []).filter(run => run.ad_account_id === link.ad_account_id)
        .reduce<string | null>((min, run) => !min || run.date_from < min ? run.date_from : min, null));
      const block = planBackfillBlock(earliest, options.now ?? new Date());
      if (!block) { result.complete += 1; continue; }
      const collected = await collectMetaClientInsights({ agencyId: target.agency_id, clientId: target.client_id, actorId: null, ...block });
      if (collected.failures.length) result.failed += 1; else result.loaded += 1;
    } catch (failure) {
      result.failed += 1;
      console.error("meta-backfill-client-failed", { clientId: target.client_id, name: failure instanceof Error ? failure.name : "unknown" });
    }
  }
  return result;
}

export type WarmResult = { warmed: number; failed: number; skippedByBudget: number; aggregates: number; aggregateFailures: number };

type WarmAccount = { id: string; name: string; currency: string; timezone_name: string };

// Same account scope as the dashboard (active link, not archived, business
// portfolio, connection of this client), so stored periods match its requests.
async function dashboardAccounts(service: SupabaseClient<Database>, target: MetaClientTarget): Promise<WarmAccount[]> {
  const { data: links } = await service.from("client_ad_accounts").select("ad_account_id")
    .eq("agency_id", target.agency_id).eq("client_id", target.client_id).eq("active", true);
  const ids = (links ?? []).map(link => link.ad_account_id);
  if (!ids.length) return [];
  const { data: connections } = await service.from("meta_connections").select("id")
    .eq("agency_id", target.agency_id).eq("client_id", target.client_id);
  const connectionIds = new Set((connections ?? []).map(connection => connection.id));
  const { data: accounts } = await service.from("meta_ad_accounts").select("id,name,currency,timezone_name,archived_at,business_id,meta_connection_id")
    .eq("agency_id", target.agency_id).in("id", ids);
  return (accounts ?? []).filter(account => !account.archived_at && /^\d+$/.test(account.business_id ?? "") && connectionIds.has(account.meta_connection_id))
    .map(account => ({ id: account.id, name: account.name, currency: account.currency, timezone_name: account.timezone_name }));
}

// Pre-computes the standard dashboard periods after the collection so the first
// view of the day is served from the stored result (public.warm_client_analytics),
// then, while time remains, refreshes Meta's exact-period aggregates for them
// (most viewed periods first), which the first view would otherwise wait for.
export async function warmStandardPeriods(service: SupabaseClient<Database>, targets: MetaClientTarget[], options: { now?: Date; budgetMs: number }): Promise<WarmResult> {
  const started = performance.now();
  const result: WarmResult = { warmed: 0, failed: 0, skippedByBudget: 0, aggregates: 0, aggregateFailures: 0 };
  const plans: Array<{ target: MetaClientTarget; accounts: WarmAccount[]; ranges: Array<{ dateFrom: string; dateTo: string }> }> = [];
  for (const target of targets) {
    const accounts = await dashboardAccounts(service, target);
    const timezones = accounts.map(account => account.timezone_name);
    const ranges = STANDARD_PERIODS.map(period => resolveAnalyticsRange({ periodo: period }, timezones.length ? timezones : REFRESH_TIMEZONE, options.now ?? new Date()));
    plans.push({ target, accounts, ranges });
    for (const range of ranges) {
      if (performance.now() - started >= options.budgetMs) { result.skippedByBudget += 1; continue; }
      const { data, error } = await service.rpc("warm_client_analytics", { p_client_id: target.client_id, p_date_from: range.dateFrom, p_date_to: range.dateTo });
      if (error || data !== true) result.failed += 1; else result.warmed += 1;
    }
  }
  for (let index = 0; index < STANDARD_PERIODS.length; index++) {
    for (const plan of plans) {
      if (!plan.accounts.length || performance.now() - started >= options.budgetMs) continue;
      const range = plan.ranges[index];
      const days = Math.round((Date.parse(`${range.dateTo}T12:00:00Z`) - Date.parse(`${range.dateFrom}T12:00:00Z`)) / 86_400_000) + 1;
      const currencies = new Set(plan.accounts.map(account => account.currency));
      const data = {
        dateFrom: range.dateFrom, dateTo: range.dateTo,
        previousDateFrom: shift(range.dateFrom, -days), previousDateTo: shift(range.dateFrom, -1),
        selectedAccountIds: plan.accounts.map(account => account.id),
        accounts: plan.accounts.map(account => ({ id: account.id, name: account.name, currency: account.currency, timezoneName: account.timezone_name })),
        currency: currencies.size === 1 ? plan.accounts[0].currency : null,
        coverage: { latestCollectedAt: null },
      } as unknown as AnalyticsDashboardData;
      try {
        await refreshMetaDashboardScope({ agencyId: plan.target.agency_id, clientId: plan.target.client_id, data });
        result.aggregates += 1;
      } catch {
        result.aggregateFailures += 1;
      }
    }
  }
  return result;
}
