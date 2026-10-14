import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";

// Transforma as linhas da Google Ads API no mesmo formato de dados da Meta (`AnalyticsDashboardData`),
// para o dashboard, o PDF, a mensagem e a IA funcionarem sem mudança.

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
// A API REST devolve números como texto (int64) ou número.
const num = (value: unknown): number => { const n = typeof value === "string" || typeof value === "number" ? Number(value) : 0; return Number.isFinite(n) ? n : 0; };

export type GoogleAccount = { id: string; customerId: string; name: string; currency: string; timezone: string; loginCustomerId?: string | null };
type Totals = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; videoViews: number };
const empty = (): Totals => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, videoViews: 0 });
function read(metrics: Row): Totals {
  return { spend: num(metrics.costMicros) / 1_000_000, impressions: num(metrics.impressions), clicks: num(metrics.clicks), conversions: num(metrics.conversions),
    conversionValue: num(metrics.conversionsValue), videoViews: num(metrics.videoTrueviewViews ?? metrics.videoViews) };
}
const add = (a: Totals, b: Totals): Totals => ({ spend: a.spend + b.spend, impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks,
  conversions: a.conversions + b.conversions, conversionValue: a.conversionValue + b.conversionValue, videoViews: a.videoViews + b.videoViews });

const CONVERSIONS = "result:provider:google:conversions";
const VIDEO_VIEWS = "result:provider:google:video_views";

// Campanhas de vídeo (YouTube) têm como resultado as visualizações; as demais, as conversões configuradas na conta.
function values(totals: Totals, video: boolean) {
  const out: Record<string, number> = {
    spend: totals.spend, impressions: totals.impressions, link_clicks: totals.clicks, clicks: totals.clicks,
    "result:provider_known": 1, [video ? VIDEO_VIEWS : CONVERSIONS]: video ? totals.videoViews : totals.conversions,
  };
  if (totals.impressions > 0) { out.ctr_link = (totals.clicks / totals.impressions) * 100; out.cpm = (totals.spend / totals.impressions) * 1000; }
  if (totals.clicks > 0) out.cpc_link = totals.spend / totals.clicks;
  if (totals.conversionValue > 0) out.attributed_revenue = totals.conversionValue;
  return out;
}

export const GOOGLE_METRICS = [
  { key: "spend", label: "Valor usado", unit: "currency", precision: 2, desirable: "neutral" },
  { key: "primary_results", label: "Resultados", unit: "integer", precision: 0, desirable: "up" },
  { key: "cost_per_result", label: "Custo por resultado", unit: "currency", precision: 2, desirable: "down" },
  { key: "impressions", label: "Impressões", unit: "integer", precision: 0, desirable: "up" },
  { key: "cpm", label: "CPM", unit: "currency", precision: 2, desirable: "down" },
  { key: "link_clicks", label: "Cliques", unit: "integer", precision: 0, desirable: "up" },
  { key: "ctr_link", label: "CTR", unit: "percent", precision: 2, desirable: "up" },
  { key: "cpc_link", label: "CPC", unit: "currency", precision: 2, desirable: "down" },
];

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const shift = (date: string, offset: number) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
/** Período anterior de mesmo tamanho, imediatamente antes. */
export function previousPeriod(from: string, to: string) {
  const length = days(from, to);
  return { from: shift(from, -length), to: shift(from, -1) };
}

export type GoogleAccountRows = { daily: Row[]; previousDaily: Row[]; campaigns: Row[] };

export function buildGoogleAnalytics(input: { account: GoogleAccount; dateFrom: string; dateTo: string; rows: GoogleAccountRows; now?: Date }): AnalyticsDashboardData {
  const { account, dateFrom, dateTo, rows } = input;
  const previous = previousPeriod(dateFrom, dateTo);
  const series = (list: Row[]) => list.map(row => ({ date: String(object(row.segments).date ?? ""), totals: read(object(row.metrics)) })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
  const dailyRows = series(rows.daily);
  const previousRows = series(rows.previousDaily);

  const campaigns = rows.campaigns.map(row => {
    const campaign = object(row.campaign);
    const video = campaign.advertisingChannelType === "VIDEO";
    const totals = read(object(row.metrics));
    return {
      id: String(campaign.id ?? ""), name: String(campaign.name ?? "Campanha"), accountName: account.name, accountId: account.id, currency: account.currency,
      status: typeof campaign.status === "string" ? campaign.status : null, values: values(totals, video), totals, video,
    };
  }).filter(campaign => campaign.id);

  // O resumo do período soma as campanhas (os resultados de cada tipo vêm só das campanhas daquele tipo).
  const sum = (video: boolean) => campaigns.filter(campaign => campaign.video === video).reduce((acc, campaign) => add(acc, campaign.totals), empty());
  const dailyTotal = dailyRows.reduce((acc, row) => add(acc, row.totals), empty());
  const summary = { ...values(dailyTotal, false), [CONVERSIONS]: sum(false).conversions, [VIDEO_VIEWS]: sum(true).videoViews };
  const previousTotal = previousRows.reduce((acc, row) => add(acc, row.totals), empty());
  const previousSummary = values(previousTotal, false);

  const collectedAt = (input.now ?? new Date()).toISOString();
  const length = days(dateFrom, dateTo);
  return normalizeClientAnalytics({
    dateFrom, dateTo, previousDateFrom: previous.from, previousDateTo: previous.to, currency: account.currency, timezoneName: account.timezone,
    accounts: [{ id: account.id, name: account.name, externalId: account.customerId, timezoneName: account.timezone, currency: account.currency }],
    selectedAccountIds: [account.id], summary, previousSummary,
    daily: dailyRows.map(row => ({ date: row.date, values: values(row.totals, false) })),
    previousDaily: previousRows.map(row => ({ date: row.date, values: values(row.totals, false) })),
    accountTotals: [{ id: account.id, name: account.name, currency: account.currency, values: summary }],
    campaigns: campaigns.map(campaign => ({
      id: campaign.id, name: campaign.name, accountName: campaign.accountName, accountId: campaign.accountId, currency: campaign.currency, status: campaign.status, values: campaign.values,
    })),
    metrics: GOOGLE_METRICS,
    // O Google Ads devolve o agregado exato do período pedido: a leitura é completa e confirmada.
    coverage: { status: "complete", previousStatus: "complete", latestCollectedAt: collectedAt, coveredDays: length, previousCoveredDays: length, totalDays: length },
    warnings: ["No Google Ads não há alcance nem frequência por pessoa; os resultados são as conversões configuradas na conta (ou as visualizações, nas campanhas de vídeo)."],
    metaAggregate: { confirmed: true, collectedAt, version: 1 },
  });
}
