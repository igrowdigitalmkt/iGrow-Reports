import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { resolveAnalyticsRange } from "@/modules/client-portal/range";
import type { ClientItem } from "@/modules/clients/schema";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import type { Database } from "@/types/database";
import type { PortfolioRow, PortfolioStatus } from "./portfolio-view";

const RESULT_LABELS = { leads: "leads", conversations: "conversas", purchases: "compras" } as const;
// A cost per result this much above the previous period is flagged for attention.
const COST_ALERT_RATIO = 1.2;

// Uses the same 30-day ranges the daily job pre-computes (account time zones), so each
// client normally reads a cached result instead of recalculating.
export async function loadPortfolioRows(supabase: SupabaseClient<Database>, clients: ClientItem[], meta: MetaAdminSnapshot | undefined, now = new Date()): Promise<PortfolioRow[]> {
  const active = clients.filter(client => !client.archived_at);
  return Promise.all(active.map(async (client): Promise<PortfolioRow> => {
    const linked = (meta?.links ?? []).filter(link => link.clientId === client.id && link.active);
    const accounts = (meta?.accounts ?? []).filter(account => linked.some(link => link.adAccountId === account.id));
    const mapping = meta?.mappings.find(item => item.clientId === client.id);
    const base: PortfolioRow = {
      id: client.id, name: client.name, linkedAccounts: linked.length, status: "no-accounts",
      currency: null, resultLabel: mapping ? RESULT_LABELS[mapping.primaryMetricKey] : "resultados",
      spend: null, previousSpend: null, results: null, previousResults: null, trend: [],
    };
    if (!linked.length) return base;
    try {
      const timezones = accounts.map(account => account.timezoneName);
      const range = resolveAnalyticsRange({ periodo: "30d" }, timezones.length ? timezones : "America/Sao_Paulo", now);
      const data = await getClientAnalytics(supabase, client.id, range.dateFrom, range.dateTo);
      if (data.coverage.status !== "complete") return { ...base, status: "updating" };
      const spend = data.summary.spend ?? null;
      const results = data.summary.primary_results ?? null;
      const previousSpend = data.coverage.previousStatus === "complete" ? data.previousSummary.spend ?? null : null;
      const previousResults = data.coverage.previousStatus === "complete" ? data.previousSummary.primary_results ?? null : null;
      const trend = data.daily.map(day => day.values.spend ?? 0);
      const lastWeek = trend.slice(-7).reduce((total, value) => total + value, 0);
      const cost = spend != null && results ? spend / results : null;
      const previousCost = previousSpend != null && previousResults ? previousSpend / previousResults : null;
      let status: PortfolioStatus = "ok";
      if (lastWeek === 0) status = "no-delivery";
      else if (cost != null && previousCost != null && cost > previousCost * COST_ALERT_RATIO) status = "cost-up";
      return { ...base, status, currency: data.currency, spend, previousSpend, results, previousResults, trend };
    } catch {
      return { ...base, status: "unavailable" };
    }
  }));
}
