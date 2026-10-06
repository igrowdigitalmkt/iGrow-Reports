import { normalizeClientAnalytics } from "./analytics-calculations";
import type { AnalyticsDashboardData } from "./analytics-types";

// Fictitious client dashboard for the demo workspace. Never written to the database.
const METRICS = [
  { key: "spend", label: "Valor usado", unit: "currency", precision: 2, desirable: "neutral" },
  { key: "primary_results", label: "Resultados", unit: "integer", precision: 0, desirable: "up" },
  { key: "cost_per_result", label: "Custo por resultado", unit: "currency", precision: 2, desirable: "down" },
  { key: "reach", label: "Alcance", unit: "integer", precision: 0, desirable: "up" },
  { key: "impressions", label: "Impressões", unit: "integer", precision: 0, desirable: "up" },
  { key: "cpm", label: "CPM", unit: "currency", precision: 2, desirable: "down" },
  { key: "link_clicks", label: "Cliques no link", unit: "integer", precision: 0, desirable: "up" },
  { key: "ctr_link", label: "CTR", unit: "percent", precision: 2, desirable: "up" },
  { key: "cpc_link", label: "CPC", unit: "currency", precision: 2, desirable: "down" },
  { key: "frequency", label: "Frequência", unit: "ratio", precision: 2, desirable: "neutral" },
  { key: "clicks", label: "Cliques (todos)", unit: "integer", precision: 0, desirable: "up" },
  { key: "inline_post_engagement", label: "Engajamento com a publicação", unit: "integer", precision: 0, desirable: "up" },
  { key: "action:landing_page_view", label: "Visualizações da página de destino", unit: "integer", precision: 0, desirable: "up" },
  { key: "video_views", label: "Visualizações de vídeo", unit: "integer", precision: 0, desirable: "up" },
];

const CAMPAIGNS = [
  { id: "910001", name: "Matrículas 2027 · Cadastro", account: "a1", spend: 1180.4, results: { "action:omni_complete_registration": 42 }, impressions: 98000, reach: 41000, clicks: 2210 },
  { id: "910002", name: "Visita guiada · Mensagens", account: "a1", spend: 860.2, results: { "action:onsite_conversion.messaging_conversation_started_7d": 188 }, impressions: 76000, reach: 30500, clicks: 1310 },
  { id: "910003", name: "Tráfego para o site", account: "a1", spend: 640.0, results: { "action:link_click": 1366 }, impressions: 121000, reach: 52000, clicks: 1980 },
  { id: "910004", name: "Instagram · Perfil", account: "a2", spend: 420.6, results: { "action:instagram_profile_visit": 967 }, impressions: 88000, reach: 39000, clicks: 1120 },
  { id: "910005", name: "Alcance da marca", account: "a2", spend: 310.0, results: { reach: 45418 }, impressions: 102000, reach: 45418, clicks: 640 },
  { id: "910006", name: "Página de destino · Bolsas", account: "a1", spend: 280.5, results: { "action:landing_page_view": 1998 }, impressions: 41000, reach: 18000, clicks: 2400 },
  { id: "910007", name: "Remarketing · Leads", account: "a2", spend: 190.3, results: { "action:lead": 31 }, impressions: 17000, reach: 6100, clicks: 380 },
  { id: "910008", name: "Processo seletivo · Vídeo", account: "a1", spend: 3.18, results: { "action:landing_page_view": 12 }, impressions: 646, reach: 400, clicks: 21 },
];

const day = (start: string, offset: number) => {
  const date = new Date(`${start}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

function values(spend: number, impressions: number, reach: number, clicks: number, extra: Record<string, number> = {}) {
  const linkClicks = Math.round(clicks * .62);
  return {
    spend, impressions, reach, clicks, link_clicks: linkClicks, frequency: impressions / Math.max(1, reach),
    cpm: spend / impressions * 1000, ctr_link: linkClicks / impressions * 100, cpc_link: spend / Math.max(1, linkClicks),
    inline_post_engagement: Math.round(clicks * 3.1), "action:landing_page_view": Math.round(linkClicks * .7), video_views: Math.round(impressions * .18),
    ...extra,
  };
}

export function getDemoClientAnalytics(): AnalyticsDashboardData {
  const dateFrom = "2026-09-05", dateTo = "2026-10-04", previousDateFrom = "2026-08-06", previousDateTo = "2026-09-04";
  const campaigns = CAMPAIGNS.map(campaign => ({
    id: campaign.id, name: campaign.name, accountId: campaign.account, accountName: campaign.account === "a1" ? "Escola Horizonte · Principal" : "Escola Horizonte · Unidade 2",
    currency: "BRL", status: "ACTIVE",
    values: values(campaign.spend, campaign.impressions, campaign.reach, campaign.clicks, {
      "result:provider_known": 1,
      ...Object.fromEntries(Object.entries(campaign.results).map(([key, amount]) => [`result:provider:${key}`, amount])),
    }),
  }));
  const total = (key: "spend" | "impressions" | "reach" | "clicks") => CAMPAIGNS.reduce((sum, campaign) => sum + campaign[key], 0);
  const summary = values(total("spend"), total("impressions"), Math.round(total("reach") * .7), total("clicks"));
  const previousSummary = values(total("spend") * .84, total("impressions") * .8, Math.round(total("reach") * .62), total("clicks") * .77);
  const daily = Array.from({ length: 30 }, (_, index) => {
    const factor = (0.6 + 0.5 * Math.sin(index / 3.2) ** 2 + (index > 15 ? .35 : 0)) / 30;
    return { date: day(dateFrom, index), values: values(summary.spend * factor * 1.05, Math.round(summary.impressions * factor), Math.round(summary.reach * factor), Math.round(summary.clicks * factor)) };
  });
  const previousDaily = daily.map((entry, index) => ({ date: day(previousDateFrom, index), values: values(entry.values.spend * .84, Math.round(entry.values.impressions * .8), Math.round(entry.values.reach * .62), Math.round(entry.values.clicks * .77)) }));
  const accountTotals = ["a1", "a2"].map(id => {
    const list = CAMPAIGNS.filter(campaign => campaign.account === id);
    const sum = (key: "spend" | "impressions" | "reach" | "clicks") => list.reduce((value, campaign) => value + campaign[key], 0);
    return { id, name: id === "a1" ? "Escola Horizonte · Principal" : "Escola Horizonte · Unidade 2", currency: "BRL", values: values(sum("spend"), sum("impressions"), sum("reach"), sum("clicks")) };
  });
  const collectedAt = "2026-10-05T09:00:00.000Z";
  return normalizeClientAnalytics({
    dateFrom, dateTo, previousDateFrom, previousDateTo, currency: "BRL", timezoneName: "America/Sao_Paulo",
    accounts: [
      { id: "a1", name: "Escola Horizonte · Principal", externalId: "act_100200300", timezoneName: "America/Sao_Paulo", currency: "BRL" },
      { id: "a2", name: "Escola Horizonte · Unidade 2", externalId: "act_100200400", timezoneName: "America/Sao_Paulo", currency: "BRL" },
    ],
    selectedAccountIds: ["a1", "a2"], summary, previousSummary, daily, previousDaily, accountTotals, campaigns, metrics: METRICS,
    coverage: { status: "complete", previousStatus: "complete", latestCollectedAt: collectedAt, coveredDays: 30, previousCoveredDays: 30, totalDays: 30 },
    warnings: [], metaAggregate: { confirmed: true, collectedAt, version: 1 },
  });
}
