import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { resolveAnalyticsRange } from "@/modules/client-portal/range";
import type { Database } from "@/types/database";
import type { Service } from "./hub-query";

/** Períodos oferecidos na aba Desempenho (os mesmos nomes do seletor de período do painel do cliente). */
export const PERFORMANCE_PERIODS = [
  { key: "today", label: "Hoje" }, { key: "7d", label: "Últimos 7 dias" }, { key: "14d", label: "Últimos 14 dias" }, { key: "30d", label: "Últimos 30 dias" },
  { key: "month", label: "Esse mês" }, { key: "last-month", label: "Último mês" }, { key: "90d", label: "Últimos 90 dias" },
] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number]["key"];

export type CampaignPerformance = {
  campaignId: string | null; name: string; leads: number; inProgress: number; visits: number; won: number; lost: number;
  spend: number | null; currency: string | null; costPerLead: number | null; costPerWon: number | null;
};
export type PerformanceData = {
  period: PerformancePeriod; dateFrom: string; dateTo: string; rows: CampaignPerformance[];
  totals: { leads: number; won: number; spend: number | null; currency: string | null; costPerLead: number | null; costPerWon: number | null };
  /** Leads do período por canal (só os canais com lead). */
  channels: { channel: "form" | "whatsapp" | "instagram"; count: number }[];
  /** O investimento do período ainda não está completo/confirmado: custos aparecem como indisponíveis, nunca como zero. */
  spendNote: string | null;
};

const round = (value: number) => Math.round(value * 100) / 100;
const isPeriod = (value: string): value is PerformancePeriod => PERFORMANCE_PERIODS.some(item => item.key === value);

type Row = { campaign_id: string | null; campaign_name: string | null; status: string };

/** Agrupa os leads por campanha e cruza com o investimento confirmado da campanha. Função pura (testável). */
export function buildPerformance(input: { rows: Row[]; spendByCampaign: Map<string, { spend: number; currency: string; name: string }> | null }): Pick<PerformanceData, "rows" | "totals"> {
  const groups = new Map<string, CampaignPerformance>();
  for (const row of input.rows) {
    const key = row.campaign_id ?? "";
    const known = row.campaign_id ? input.spendByCampaign?.get(row.campaign_id) : undefined;
    const group = groups.get(key) ?? { campaignId: row.campaign_id, name: known?.name ?? row.campaign_name ?? (row.campaign_id ? `Campanha …${row.campaign_id.slice(-4)}` : "Sem campanha identificada"),
      leads: 0, inProgress: 0, visits: 0, won: 0, lost: 0, spend: known ? known.spend : null, currency: known?.currency ?? null, costPerLead: null, costPerWon: null };
    group.leads += 1;
    if (row.status === "contacted") group.inProgress += 1;
    else if (row.status === "visit") group.visits += 1;
    else if (row.status === "won") group.won += 1;
    else if (row.status === "lost") group.lost += 1;
    groups.set(key, group);
  }
  const rows = [...groups.values()].map(group => ({
    ...group, costPerLead: group.spend != null && group.leads > 0 ? round(group.spend / group.leads) : null, costPerWon: group.spend != null && group.won > 0 ? round(group.spend / group.won) : null,
  })).sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name, "pt-BR"));
  // Totais de custo só quando TODAS as campanhas com lead têm investimento conhecido (e, se houver "sem campanha", ele não entra no custo).
  const costed = rows.filter(row => row.campaignId);
  const allKnown = costed.length > 0 && costed.every(row => row.spend != null);
  const currencies = new Set(costed.map(row => row.currency));
  const spend = allKnown && currencies.size === 1 ? round(costed.reduce((total, row) => total + (row.spend ?? 0), 0)) : null;
  const costedLeads = costed.reduce((total, row) => total + row.leads, 0);
  const costedWon = costed.reduce((total, row) => total + row.won, 0);
  return { rows, totals: {
    leads: rows.reduce((total, row) => total + row.leads, 0), won: rows.reduce((total, row) => total + row.won, 0), spend, currency: spend != null ? [...currencies][0] ?? null : null,
    costPerLead: spend != null && costedLeads > 0 ? round(spend / costedLeads) : null, costPerWon: spend != null && costedWon > 0 ? round(spend / costedWon) : null,
  } };
}

/** Janela do período em horário de Brasília (UTC−3, sem horário de verão). */
export const windowOf = (dateFrom: string, dateTo: string) => ({ from: `${dateFrom}T00:00:00-03:00`, to: `${dateTo}T23:59:59.999-03:00` });

export async function loadPerformance(input: { service: Service; supabase: SupabaseClient<Database>; clientId: string; period: string }): Promise<PerformanceData | null> {
  const period: PerformancePeriod = isPeriod(input.period) ? input.period : "30d";
  const range = resolveAnalyticsRange({ periodo: period });
  const pages = await input.service.from("lead_pages").select("id").eq("client_id", input.clientId);
  const pageIds = (pages.data ?? []).map(page => page.id);
  if (pages.error) return null;
  const window = windowOf(range.dateFrom, range.dateTo);
  const leads = pageIds.length
    ? await input.service.from("leads").select("campaign_id,campaign_name,status,channel").in("lead_page_id", pageIds).gte("created_time", window.from).lte("created_time", window.to).limit(5000)
    : { data: [] as Row[], error: null };
  if (leads.error) return null;

  // Investimento confirmado por campanha no período (mesma fonte do painel do cliente). Indisponível ≠ zero.
  let spendByCampaign: Map<string, { spend: number; currency: string; name: string }> | null = null;
  let spendNote: string | null = null;
  try {
    const analytics = await getClientAnalytics(input.supabase, input.clientId, range.dateFrom, range.dateTo);
    if (analytics.coverage.status === "complete") {
      spendByCampaign = new Map(analytics.campaigns.filter(campaign => typeof campaign.values.spend === "number" && Number.isFinite(campaign.values.spend))
        .map(campaign => [campaign.id, { spend: campaign.values.spend as number, currency: campaign.currency, name: campaign.name }]));
    } else spendNote = "A coleta do investimento deste período ainda não está completa: os custos aparecem quando ela terminar.";
  } catch { spendNote = "Não foi possível ler o investimento agora. Os custos aparecem quando a leitura voltar."; }
  const built = buildPerformance({ rows: (leads.data ?? []) as Row[], spendByCampaign });
  if (!spendNote && built.rows.some(row => row.campaignId && row.spend == null)) spendNote = "Algumas campanhas não têm investimento confirmado neste período (por exemplo, de outra conta de anúncios): o custo delas fica indisponível.";
  const counts = new Map<string, number>();
  for (const row of (leads.data ?? []) as { channel?: string }[]) counts.set(row.channel ?? "form", (counts.get(row.channel ?? "form") ?? 0) + 1);
  const channels = ((["form", "whatsapp", "instagram"] as const).filter(channel => counts.has(channel))).map(channel => ({ channel, count: counts.get(channel) ?? 0 }));
  return { period, dateFrom: range.dateFrom, dateTo: range.dateTo, ...built, channels, spendNote };
}
