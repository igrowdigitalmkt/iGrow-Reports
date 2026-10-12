import { resultBreakdown, resultCostBreakdown } from "@/modules/client-portal/analytics-results";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import type { AnalyticsDashboardData, AnalyticsValues } from "@/modules/client-portal/analytics-types";

// Fatos confirmados de um relatório, calculados só pelo código. O PDF e a IA recebem estes
// valores prontos: a IA interpreta e escreve, nunca calcula. Ausência é null, nunca zero.

export type Change = { current: number | null; previous: number | null; changePct: number | null };

export type ResultFact = {
  key: string;
  label: string;
  quantity: number;
  // null quando o período anterior não tem cobertura completa ou os tipos do anterior não são conhecidos.
  previousQuantity: number | null;
  changePct: number | null;
  // Investimento das campanhas que trabalharam esse tipo; null quando não concilia com o total.
  spend: number | null;
  costPerResult: number | null;
};

export type CampaignFact = {
  id: string;
  name: string;
  accountName: string;
  spend: number;
  shareOfSpend: number | null;
  // Presente só quando a campanha tem um único tipo de resultado; senão mixedResults = true.
  result: { key: string; label: string; quantity: number } | null;
  mixedResults: boolean;
  costPerResult: number | null;
};

export type ReportFacts = {
  period: { from: string; to: string; previousFrom: string; previousTo: string; comparable: boolean };
  currency: string | null;
  spend: Change;
  results: ResultFact[];
  delivery: { reach: Change; impressions: Change; cpm: Change; frequency: Change; linkClicks: Change; reachEstimated: boolean };
  campaigns: CampaignFact[];
  // Quantas campanhas tiveram investimento no período (a lista acima pode ser só as de maior investimento).
  campaignsWithSpend: number;
  accounts: Array<{ name: string; spend: number; shareOfSpend: number | null }>;
  // Limites conhecidos desta leitura; o texto da IA deve respeitá-los.
  limitations: string[];
};

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

export function percentChange(current: number | null, previous: number | null): number | null {
  if (!finite(current) || !finite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function change(current: number | null | undefined, previous: number | null | undefined, comparable: boolean): Change {
  const now = finite(current) ? current : null;
  const before = comparable && finite(previous) ? previous : null;
  return { current: now, previous: before, changePct: percentChange(now, before) };
}

function frequency(values: AnalyticsValues): number | null {
  const impressions = values.impressions, reach = values.reach;
  return finite(impressions) && finite(reach) && reach > 0 ? impressions / reach : null;
}

const TOP_CAMPAIGNS = 10;

// Relatórios salvos guardam as campanhas na hierarquia (`entities`); o painel, em `data.campaigns`.
function campaignSources(data: AnalyticsDashboardData, entities?: AnalyticsEntity[]) {
  const fromEntities = entities?.filter(entity => entity.level === "campaign") ?? [];
  return fromEntities.length > 0 ? fromEntities : data.campaigns;
}

export function buildReportFacts(data: AnalyticsDashboardData, entities?: AnalyticsEntity[]): ReportFacts {
  const sources = campaignSources(data, entities);
  const comparable = data.coverage.status === "complete" && data.coverage.previousStatus === "complete";
  const limitations: string[] = [];
  if (!comparable) limitations.push("Sem comparação com o período anterior: a cobertura de um dos períodos não está completa.");

  const spendNow = data.summary.spend;
  const current = resultBreakdown(data.summary);
  const previousKnown = comparable && data.previousSummary["result:provider_known"] === 1;
  const previous = new Map(resultBreakdown(data.previousSummary).map(result => [result.key, result.value]));
  const costs = new Map(resultCostBreakdown(data.summary, sources.map(campaign => ({
    values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId,
  }))).map(row => [row.key, row.cost]));

  const results: ResultFact[] = current.map(result => {
    const cost = costs.get(result.key) ?? null;
    const before = previousKnown ? (previous.get(result.key) ?? 0) : null;
    return {
      key: result.key, label: result.label, quantity: result.value,
      previousQuantity: before, changePct: percentChange(result.value, before),
      spend: cost != null ? cost * result.value : null, costPerResult: cost,
    };
  });
  if (results.length > 0 && results.some(result => result.costPerResult == null)) {
    limitations.push("O custo por resultado de pelo menos um tipo não pôde ser conciliado com o investimento das campanhas.");
  }
  if (results.length > 0) limitations.push("O custo por resultado do período anterior não está disponível; só as quantidades são comparadas.");
  if (current.length === 0) limitations.push("Os tipos de resultado do período não estão confirmados.");

  const withSpend = sources.filter(campaign => finite(campaign.values.spend) && (campaign.values.spend ?? 0) > 0);
  const campaigns: CampaignFact[] = withSpend
    .map(campaign => {
      const spend = campaign.values.spend as number;
      const entries = resultBreakdown(campaign.values);
      const single = entries.length === 1 ? entries[0] : null;
      return {
        id: campaign.id, name: campaign.name, accountName: campaign.accountName, spend,
        shareOfSpend: finite(spendNow) && spendNow > 0 ? (spend / spendNow) * 100 : null,
        result: single ? { key: single.key, label: single.label, quantity: single.value } : null,
        mixedResults: entries.length > 1,
        costPerResult: single && single.value > 0 ? spend / single.value : null,
      };
    })
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_CAMPAIGNS);
  if (withSpend.length > campaigns.length) {
    limitations.push(`A lista de campanhas mostra só as ${campaigns.length} de maior investimento, de ${withSpend.length} com investimento no período.`);
  }

  const selected = data.accountTotals.filter(account => data.selectedAccountIds.includes(account.id));
  const accounts = selected.map(account => {
    const spend = finite(account.values.spend) ? account.values.spend : 0;
    return { name: account.name, spend, shareOfSpend: finite(spendNow) && spendNow > 0 ? (spend / spendNow) * 100 : null };
  });
  const reachEstimated = data.selectedAccountIds.length > 1;
  if (reachEstimated) limitations.push("Alcance e frequência são estimados entre contas: a mesma pessoa pode ser contada mais de uma vez.");

  return {
    period: { from: data.dateFrom, to: data.dateTo, previousFrom: data.previousDateFrom, previousTo: data.previousDateTo, comparable },
    currency: data.currency,
    spend: change(spendNow, data.previousSummary.spend, comparable),
    results,
    delivery: {
      reach: change(data.summary.reach, data.previousSummary.reach, comparable),
      impressions: change(data.summary.impressions, data.previousSummary.impressions, comparable),
      cpm: change(data.summary.cpm, data.previousSummary.cpm, comparable),
      frequency: change(frequency(data.summary), frequency(data.previousSummary), comparable),
      linkClicks: change(data.summary.link_clicks, data.previousSummary.link_clicks, comparable),
      reachEstimated,
    },
    campaigns, campaignsWithSpend: withSpend.length, accounts, limitations,
  };
}
