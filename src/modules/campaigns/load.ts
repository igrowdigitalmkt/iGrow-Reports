import "server-only";

import { z } from "zod";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { getFreshClientAnalytics } from "@/modules/client-portal/analytics-live";
import { loadClientHierarchy } from "@/modules/client-portal/analytics-hierarchy-loader";
import { resolveAnalyticsRange } from "@/modules/client-portal/range";
import type { AnalyticsMetric, AnalyticsValues } from "@/modules/client-portal/analytics-types";
import type { LiveDeliveryState } from "@/modules/meta/delivery";
import type { LiveReadReport } from "@/modules/meta/server";
import { BASE_METRIC_KEYS, FALLBACK_BASE_METRICS } from "./columns";
import { cachedLiveReader } from "./live-cache";
import { classifyDelivery } from "./delivery-state";
import type { CampaignRow } from "./tree";

/** O cliente vem da rota (/clientes/ID/campanhas), nunca da busca. */
export type CampaignsQuery = { periodo?: string; from?: string; to?: string; contas?: string; ativas?: string };

export type CampaignsData = {
  state: "ready" | "no-accounts" | "blocked" | "error";
  message: string | null;
  period: string; dateFrom: string; dateTo: string; today: string;
  accounts: { id: string; name: string; currency: string }[];
  selectedAccountIds: string[];
  metrics: AnalyticsMetric[];
  /**
   * Situação das MÉTRICAS históricas, independente do catálogo (campanhas, conjuntos e anúncios lidos ao vivo na Meta):
   * "confirmed" = cobertura completa do período; "pending" = coleta em andamento ou incompleta (as linhas existem, mas sem nenhum valor).
   */
  metricsState: "confirmed" | "pending";
  rows: CampaignRow[];
  /** Última coleta das métricas históricas confirmadas do período. */
  latestCollectedAt: string | null;
  /** Leitura do estado atual na Meta: "unavailable" nunca é apresentada como atualização bem-sucedida. */
  live: { state: "ok" | "partial" | "unavailable"; checkedAt: string | null; accountsRead: number; accountsTotal: number; cached?: boolean };
  warnings: string[];
};

const FILTER_ERROR = "Filtro inválido. Exibindo os últimos 30 dias completos.";
const LIVE_PARTIAL = (missing: number) => `O estado atual de ${missing} conta(s) não pôde ser consultado na Meta: essas entidades aparecem como Indisponível e conjuntos ou anúncios sem movimentação podem faltar.`;
const PENDING_AND_UNAVAILABLE = "A coleta das métricas deste período ainda está em andamento e não foi possível ler as campanhas na Meta agora. Tente novamente em instantes.";
const LIVE_UNAVAILABLE = "Não foi possível consultar o estado atual na Meta. A veiculação aparece como Indisponível e campanhas, conjuntos e anúncios sem movimentação no período podem não aparecer.";

/**
 * Lê as campanhas de UM cliente da organização. Autoriza no servidor (requireClientDashboardAccess), usa os mesmos agregados
 * confirmados e a mesma leitura ao vivo do painel do cliente e não escreve em nenhuma plataforma.
 */
export async function loadCampaignsData(clientId: string, query: CampaignsQuery): Promise<CampaignsData> {
  const { supabase, access } = await requireClientDashboardAccess(clientId);
  const { data: context } = await supabase.rpc("get_client_portal_data_context", { p_client_id: clientId }).single();
  const timezone = context?.timezone_name ?? "America/Sao_Paulo";
  let range = resolveAnalyticsRange({}, timezone);
  let message: string | null = null;
  let accountIds: string[] | undefined;
  try {
    range = resolveAnalyticsRange(query, timezone);
    if (query.contas) accountIds = z.array(z.uuid()).max(100).parse(query.contas.split(","));
  } catch (error) {
    message = error instanceof Error && !(error instanceof z.ZodError) ? `${error.message} Exibindo os últimos 30 dias completos.` : FILTER_ERROR;
    accountIds = undefined;
  }
  const empty = (state: CampaignsData["state"], text: string | null, extra: Partial<CampaignsData> = {}): CampaignsData => ({
    state, message: text ?? message, period: range.period, dateFrom: range.dateFrom, dateTo: range.dateTo, today: range.dateTo,
    accounts: [], selectedAccountIds: [], metrics: [], metricsState: "pending", rows: [], latestCollectedAt: null,
    live: { state: "unavailable", checkedAt: null, accountsRead: 0, accountsTotal: 0 }, warnings: [], ...extra,
  });
  try {
    let data = await getClientAnalytics(supabase, clientId, range.dateFrom, range.dateTo, accountIds);
    if (range.period !== "custom") {
      const complete = resolveAnalyticsRange({ periodo: range.period }, data.accounts.filter(account => data.selectedAccountIds.includes(account.id)).map(account => account.timezoneName));
      if (complete.dateTo !== range.dateTo) {
        range = complete;
        data = await getClientAnalytics(supabase, clientId, range.dateFrom, range.dateTo, accountIds);
      }
    }
    const accounts = data.accounts.map(account => ({ id: account.id, name: account.name, currency: account.currency }));
    if (!data.accounts.length) return empty("no-accounts", "Este cliente ainda não tem conta de anúncios da Meta vinculada.");
    const today = resolveAnalyticsRange({ periodo: "today" }, data.accounts.map(account => account.timezoneName)).dateTo;
    data = await getFreshClientAnalytics({ supabase, agencyId: access.agencyId, clientId, dateFrom: range.dateFrom, dateTo: range.dateTo, accountIds, initial: data });
    const base = { accounts, selectedAccountIds: data.selectedAccountIds, today, latestCollectedAt: data.coverage.latestCollectedAt, warnings: data.warnings };
    if (!data.selectedAccountIds.length) return empty("blocked", "Não há contas de anúncios selecionadas disponíveis para este período.", base);
    // Catálogo e métricas são independentes: sem cobertura completa o catálogo operacional continua (estado ao vivo da Meta), mas nenhuma
    // métrica histórica é mostrada. A cobertura incompleta nunca esconde a existência das campanhas.
    const metricsConfirmed = data.coverage.status === "complete";
    const rawStates: Record<string, LiveDeliveryState> = {};
    let readAt = Date.now();
    let fromCache = false;
    const report: LiveReadReport = { entities: [], accountsRead: [], accountsFailed: [] };
    const hierarchy = await loadClientHierarchy({ supabase, agencyId: access.agencyId, clientId, dateFrom: range.dateFrom, dateTo: range.dateTo,
      accountIds: data.selectedAccountIds, analytics: data, rawStates, report, fullCatalog: query.ativas !== "1", catalogOnly: !metricsConfirmed,
      readLive: cachedLiveReader((at, hit) => { readAt = at; fromCache = hit; }) });
    if ("error" in hierarchy) return empty("error", hierarchy.error ?? null, base);
    const accountsRead = new Set(report.accountsRead).size;
    const live: CampaignsData["live"] = { accountsRead, accountsTotal: data.selectedAccountIds.length,
      state: accountsRead === 0 ? "unavailable" : accountsRead < data.selectedAccountIds.length ? "partial" : "ok",
      checkedAt: accountsRead ? new Date(readAt).toISOString() : null, cached: accountsRead > 0 && fromCache };
    // Coleta incompleta E sem leitura do catálogo na Meta: não há o que mostrar com segurança (nunca dados antigos como se fossem atuais).
    if (!metricsConfirmed && live.state === "unavailable") return empty("blocked", PENDING_AND_UNAVAILABLE, { ...base, live });
    // Só viajam para o navegador os valores que a tabela usa (métricas base e resultados por tipo), não todas as ações da Meta.
    const slim = (values: AnalyticsValues): AnalyticsValues => Object.fromEntries(Object.entries(values).filter(([key]) => BASE_METRIC_KEYS.includes(key) || key.startsWith("result:")));
    const mapped: CampaignRow[] = hierarchy.entities.map(entity => ({
      ...entity, values: metricsConfirmed ? slim(entity.values) : {}, ...(metricsConfirmed ? {} : { metricsPending: true }),
      state: classifyDelivery(rawStates[`${entity.accountId}:${entity.key}`],
        entity.effectiveStatus === "ACTIVE" ? true : entity.effectiveStatus === "INACTIVE" ? false : null),
    }));
    // Arquivados ou excluídos sem gasto no período não são operáveis e só poluiriam a lista completa; seus filhos saem junto.
    const gone = new Set<string>();
    for (const level of ["campaign", "adset", "ad"] as const) for (const row of mapped.filter(item => item.level === level)) {
      const parent = row.parentId ? `${row.accountId}:${level === "ad" ? "adset" : "campaign"}:${row.parentId}` : null;
      const archived = ["ARCHIVED", "DELETED"].includes(rawStates[`${row.accountId}:${row.key}`]?.status ?? "") && !((row.values.spend ?? 0) > 0);
      if (archived || (parent && gone.has(parent))) gone.add(`${row.accountId}:${row.key}`);
    }
    const rows = mapped.filter(row => !gone.has(`${row.accountId}:${row.key}`));
    const metrics = metricsConfirmed ? BASE_METRIC_KEYS.flatMap(key => data.metrics.filter(metric => metric.key === key))
      : BASE_METRIC_KEYS.flatMap(key => FALLBACK_BASE_METRICS.filter(metric => metric.key === key));
    const notices = [live.state === "partial" ? LIVE_PARTIAL(live.accountsTotal - accountsRead) : live.state === "unavailable" ? LIVE_UNAVAILABLE : null, message].filter(Boolean);
    return empty("ready", notices.join(" ") || null, { ...base, metrics, rows, live, metricsState: metricsConfirmed ? "confirmed" : "pending" });
  } catch (error) {
    console.error("campaigns-load", { name: error instanceof Error ? error.name : typeof error, clientId });
    return empty("error", "Não foi possível consultar as campanhas deste cliente agora. Tente novamente em instantes.");
  }
}
