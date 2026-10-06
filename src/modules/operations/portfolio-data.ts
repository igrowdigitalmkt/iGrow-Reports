import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { resolveAnalyticsRange } from "@/modules/client-portal/range";
import { resultBreakdown } from "@/modules/client-portal/analytics-results";
import type { ClientItem } from "@/modules/clients/schema";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import type { Database } from "@/types/database";
import type { PortfolioRow, PortfolioStatus } from "./portfolio-view";

// A cost per result this much above the previous period is flagged for attention.
const COST_ALERT_RATIO = 1.2;

export type PortfolioPeriod = "7d" | "30d" | "90d";
export const PORTFOLIO_PERIODS: Array<{ key: PortfolioPeriod; label: string }> = [
  { key: "7d", label: "Últimos 7 dias" }, { key: "30d", label: "Últimos 30 dias" }, { key: "90d", label: "Últimos 90 dias" },
];
export const portfolioPeriod = (value: string | undefined): PortfolioPeriod => value === "7d" || value === "90d" ? value : "30d";

// Uses the same standard ranges the daily job pre-computes (account time zones), so each
// client normally reads a cached result instead of recalculating.
export async function loadPortfolioRows(supabase: SupabaseClient<Database>, clients: ClientItem[], meta: MetaAdminSnapshot | undefined, period: PortfolioPeriod = "30d", now = new Date()): Promise<PortfolioRow[]> {
  const active = clients.filter(client => !client.archived_at);
  return Promise.all(active.map(async (client): Promise<PortfolioRow> => {
    const linked = (meta?.links ?? []).filter(link => link.clientId === client.id && link.active);
    const accounts = (meta?.accounts ?? []).filter(account => linked.some(link => link.adAccountId === account.id));
    const base: PortfolioRow = {
      id: client.id, name: client.name, linkedAccounts: linked.length, status: "no-accounts",
      currency: null, spend: null, previousSpend: null, reach: null, impressions: null, results: [], trend: [], previousTrend: [], days: [],
    };
    if (!linked.length) return base;
    try {
      const timezones = accounts.map(account => account.timezoneName);
      const range = resolveAnalyticsRange({ periodo: period }, timezones.length ? timezones : "America/Sao_Paulo", now);
      const data = await getClientAnalytics(supabase, client.id, range.dateFrom, range.dateTo);
      if (data.coverage.status !== "complete") return { ...base, status: "updating" };
      const spend = data.summary.spend ?? null;
      const previousComplete = data.coverage.previousStatus === "complete";
      const previousSpend = previousComplete ? data.previousSummary.spend ?? null : null;
      // Every result type of the period: clients often mix messages, sign-ups, reach and visits.
      const previous = new Map(previousComplete ? resultBreakdown(data.previousSummary).map(result => [result.key, result.value]) : []);
      const results = resultBreakdown(data.summary).sort((a, b) => b.value - a.value).map(result => ({
        key: result.key, label: result.label.toLocaleLowerCase("pt-BR"), value: result.value,
        cost: spend != null && result.value > 0 ? spend / result.value : null,
        previousCost: previousSpend != null && (previous.get(result.key) ?? 0) > 0 ? previousSpend / previous.get(result.key)! : null,
      }));
      // With several result types the spend is shared between them, so no per-type cost is shown.
      if (results.length > 1) for (const result of results) { result.cost = null; result.previousCost = null; }
      const trend = data.daily.map(day => day.values.spend ?? 0);
      const days = data.daily.map(day => day.date);
      const previousTrend = previousComplete ? data.previousDaily.map(day => day.values.spend ?? 0) : [];
      const lastWeek = trend.slice(-7).reduce((total, value) => total + value, 0);
      // Cost comparison only holds for a single result type: with several, spend is shared.
      const costUp = results.length === 1 && results[0].cost != null && results[0].previousCost != null && results[0].cost > results[0].previousCost * COST_ALERT_RATIO;
      let status: PortfolioStatus = "ok";
      if (lastWeek === 0) status = "no-delivery";
      else if (costUp) status = "cost-up";
      return { ...base, status, currency: data.currency, spend, previousSpend, reach: data.summary.reach ?? null, impressions: data.summary.impressions ?? null, results, trend, previousTrend, days };
    } catch {
      return { ...base, status: "unavailable" };
    }
  }));
}
