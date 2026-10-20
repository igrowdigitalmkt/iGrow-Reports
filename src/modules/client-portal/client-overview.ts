import { resultCostBreakdown } from "./analytics-results";
import type { AnalyticsDashboardData, AnalyticsValues } from "./analytics-types";

/** Uma conta do Google Ads com os dados do período (mesmo formato usado pela seção do Dashboard). */
export type OverviewGoogleSection = { id: string; name: string; data: AnalyticsDashboardData };

export type OverviewResult = { key: string; label: string; value: number; cost: number | null };
export type OverviewAccount = {
  platform: "meta" | "google"; id: string; name: string; detail: string; currency: string;
  spend: number | null; results: OverviewResult[]; trend: number[]; days: string[];
};
export type OverviewCampaign = { platform: "meta" | "google"; id: string; accountId: string; name: string; accountName: string; currency: string; status: string | null; active: boolean; spend: number | null; result: OverviewResult | null };

/** Campanha configurada como ativa (Meta: ACTIVE; Google: ENABLED). */
export const isActiveCampaignStatus = (status: string | null | undefined) => status === "ACTIVE" || status === "ENABLED";

/**
 * Ordem das campanhas: primeiro as ativas/em veiculação (as de maior investimento antes), depois as que investiram no período
 * selecionado. Campanha parada e sem investimento no período não entra.
 */
export function rankCampaigns<T extends { status: string | null; spend: number | null }>(rows: T[]): T[] {
  const bySpend = (a: T, b: T) => (b.spend ?? 0) - (a.spend ?? 0);
  const active = rows.filter(row => isActiveCampaignStatus(row.status)).sort(bySpend);
  const spent = rows.filter(row => !isActiveCampaignStatus(row.status) && (row.spend ?? 0) > 0).sort(bySpend);
  return [...active, ...spent];
}
export type ClientOverview = {
  accounts: OverviewAccount[];
  campaigns: OverviewCampaign[];
  /** Moeda única do cliente (null quando as contas usam moedas diferentes: nada é somado entre moedas). */
  currency: string | null;
  spend: number | null;
  previousSpend: number | null;
  results: OverviewResult[];
  days: string[];
  trend: number[];
  previousTrend: number[];
  platformCounts: { meta: number; google: number };
};

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const spendOf = (values: AnalyticsValues) => (finite(values.spend) ? values.spend : null);

function resultsOf(values: AnalyticsValues, sources: Array<{ values: AnalyticsValues; id: string; accountId: string }>): OverviewResult[] {
  return resultCostBreakdown(values, sources.map(source => ({ ...source, level: "campaign" as const })))
    .map(result => ({ key: result.key, label: result.label, value: result.value, cost: result.cost })).sort((a, b) => b.value - a.value);
}

/**
 * Resumo do cliente em todas as plataformas: investimento, resultados e série diária. Valores só são somados quando as contas usam a
 * mesma moeda e quando todas informam o dado; o que não pôde ser confirmado fica vazio (nunca zero).
 */
export function buildClientOverview(meta: AnalyticsDashboardData, google: OverviewGoogleSection[], campaignLimit = 8): ClientOverview {
  const selected = meta.accounts.filter(account => meta.selectedAccountIds.includes(account.id));
  const accounts: OverviewAccount[] = selected.map(account => {
    const totals = meta.accountTotals.find(item => item.id === account.id);
    const values = totals?.values ?? {};
    const sources = meta.campaigns.filter(campaign => campaign.accountId === account.id).map(campaign => ({ values: campaign.values, id: campaign.id, accountId: campaign.accountId }));
    // A série diária da Meta vem somada; só é da conta quando ela é a única selecionada.
    const single = selected.length === 1;
    return {
      platform: "meta", id: account.id, name: account.name, currency: account.currency,
      detail: `${account.externalId} · ${account.currency} · ${account.timezoneName}`,
      spend: spendOf(values), results: totals ? resultsOf(values, sources) : [],
      trend: single ? meta.daily.map(day => day.values.spend ?? 0) : [], days: single ? meta.daily.map(day => day.date) : [],
    };
  });
  for (const section of google) {
    const { data } = section;
    const sources = data.campaigns.map(campaign => ({ values: campaign.values, id: campaign.id, accountId: campaign.accountId }));
    accounts.push({
      platform: "google", id: section.id, name: section.name, currency: data.currency ?? "BRL",
      detail: `${data.currency ?? "BRL"}${data.timezoneName ? ` · ${data.timezoneName}` : ""}`,
      spend: spendOf(data.summary), results: resultsOf(data.summary, sources),
      trend: data.daily.map(day => day.values.spend ?? 0), days: data.daily.map(day => day.date),
    });
  }

  const currencies = new Set(accounts.map(account => account.currency));
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  const confirmed = accounts.every(account => account.spend != null);
  const spend = currency && accounts.length && confirmed ? accounts.reduce((total, account) => total + (account.spend ?? 0), 0) : null;

  const metaPrevious = selected.length ? spendOf(meta.previousSummary) : 0;
  const googlePrevious = google.map(section => spendOf(section.data.previousSummary));
  const previousParts = [metaPrevious, ...googlePrevious];
  const previousSpend = currency && previousParts.every(finite) ? previousParts.reduce((total, value) => total + value, 0) : null;

  const totals = new Map<string, OverviewResult>();
  for (const account of accounts) for (const result of account.results) {
    const current = totals.get(result.key) ?? { key: result.key, label: result.label, value: 0, cost: null };
    current.value += result.value;
    totals.set(result.key, current);
  }
  const results = [...totals.values()].sort((a, b) => b.value - a.value);

  // Série diária combinada (soma por data) e a do período anterior, quando todas as contas têm as duas.
  const series = [
    ...(selected.length ? [{ daily: meta.daily, previous: meta.previousDaily }] : []),
    ...google.map(section => ({ daily: section.data.daily, previous: section.data.previousDaily })),
  ];
  const days = currency ? [...new Set(series.flatMap(item => item.daily.map(day => day.date)))].sort() : [];
  const trend = days.map(date => series.reduce((total, item) => total + (item.daily.find(day => day.date === date)?.values.spend ?? 0), 0));
  const aligned = series.length > 0 && series.every(item => item.previous.length === days.length);
  const previousTrend = currency && aligned ? days.map((_, index) => series.reduce((total, item) => total + (item.previous[index]?.values.spend ?? 0), 0)) : [];

  const campaignRows: OverviewCampaign[] = [
    ...meta.campaigns.filter(campaign => meta.selectedAccountIds.includes(campaign.accountId)).map(campaign => ({ platform: "meta" as const, campaign })),
    ...google.flatMap(section => section.data.campaigns.map(campaign => ({ platform: "google" as const, campaign }))),
  ].map(({ platform, campaign }) => ({
    platform, id: campaign.id, accountId: campaign.accountId, name: campaign.name, accountName: campaign.accountName, currency: campaign.currency,
    status: campaign.status, active: isActiveCampaignStatus(campaign.status), spend: spendOf(campaign.values),
    result: resultsOf(campaign.values, [{ values: campaign.values, id: campaign.id, accountId: campaign.accountId }])[0] ?? null,
  }));
  const campaigns = rankCampaigns(campaignRows).slice(0, campaignLimit);

  return {
    accounts, campaigns, currency, spend, previousSpend, results, days, trend, previousTrend,
    platformCounts: { meta: selected.length, google: google.length },
  };
}
