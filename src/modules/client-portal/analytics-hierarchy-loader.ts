import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { confirmedEmptyPeriodValues } from "@/modules/meta/insight-values";
import { getMetaEntityStatuses, type LiveCampaignIdentity, type LiveReadReport } from "@/modules/meta/server";
import type { LiveDeliveryState } from "@/modules/meta/delivery";
import { getFreshClientAnalytics } from "./analytics-live";
import { normalizeHierarchy, relevantCampaignHierarchy, type AnalyticsEntity } from "./analytics-hierarchy";
import type { AnalyticsDashboardData } from "./analytics-types";

/**
 * Árvore campanha → conjunto → anúncio de um cliente/período, com identidade de conta vinda do catálogo autenticado
 * e veiculação lida ao vivo na Meta. Compartilhada pelo painel do cliente e pela área de Campanhas.
 * O chamador é responsável por autorizar o acesso ao cliente. `analytics` evita repetir a leitura quando já está confirmada;
 * `rawStates` recebe o estado bruto da Meta por `${conta}:${entidade}` sem alterar o resultado.
 */
export async function loadClientHierarchy(input: {
  supabase: SupabaseClient<Database>; agencyId: string; clientId: string; dateFrom: string; dateTo: string; accountIds: string[];
  analytics?: AnalyticsDashboardData; rawStates?: Record<string, LiveDeliveryState>;
  /**
   * Inclui todo o catálogo que a Meta devolve (campanhas, conjuntos e anúncios), mesmo sem gasto no período; o painel do cliente
   * os oculta. Entidade sem linha confirmada fica sempre sem métricas (nunca zero presumido). `report` recebe o resultado da leitura.
   */
  fullCatalog?: boolean; report?: LiveReadReport;
  /**
   * Somente o CATÁLOGO operacional lido ao vivo na Meta (nome, identificador, parentesco e estado), SEM métricas históricas: não exige a
   * cobertura completa do período e não consulta as linhas de métricas. Toda entidade sai sem valores (desconhecido, nunca zero).
   * Exige `analytics` (identidade das contas) e `report`; sem leitura ao vivo não há catálogo (lista vazia, nunca dado antigo).
   */
  catalogOnly?: boolean;
  /** Leitor do estado ao vivo; a área de Campanhas injeta uma versão com cache curto. Padrão: leitura direta. */
  readLive?: typeof getMetaEntityStatuses;
}) {
  const visible = input.fullCatalog ? (list: AnalyticsEntity[]) => list : relevantCampaignHierarchy;
  const { supabase } = input;
  if (input.catalogOnly && !input.analytics) return { error: "Não foi possível identificar as contas para ler o catálogo." };
  const analytics = input.analytics ?? await getFreshClientAnalytics({ supabase, agencyId: input.agencyId,
    clientId: input.clientId, dateFrom: input.dateFrom, dateTo: input.dateTo,
    accountIds: input.accountIds });
  if (!input.catalogOnly && analytics.coverage.status !== "complete") {
    return { error: "Campanhas e métricas permanecem ocultas até a coleta do período estar completa." };
  }
  let entities: AnalyticsEntity[] = [];
  if (!input.catalogOnly) {
    const { data, error } = await supabase.rpc("get_client_analytics_hierarchy", {
      p_client_id: input.clientId,
      p_date_from: input.dateFrom,
      p_date_to: input.dateTo,
      p_ad_account_ids: input.accountIds,
    });
    if (error || !data) return { error: "Não foi possível carregar a árvore de campanhas deste período." };
    entities = normalizeHierarchy(data);
  }
  // The hierarchy RPC can legitimately omit a campaign when a detail level
  // has no child rows. The period aggregate is still authoritative for
  // visibility: campaigns with positive spend must remain available for every
  // client, regardless of whether Meta returned descendants for them.
  const knownCampaigns = new Set(entities.filter(entity => entity.level === "campaign")
    .map(entity => `${entity.accountId}:${entity.id}`));
  for (const campaign of input.catalogOnly ? [] : Array.isArray(analytics.campaigns) ? analytics.campaigns : []) {
    if (!(campaign.values.spend != null && Number.isFinite(campaign.values.spend) && campaign.values.spend > 0)) continue;
    const key = `${campaign.accountId}:${campaign.id}`;
    if (knownCampaigns.has(key)) continue;
    entities.push({ ...campaign, key: `campaign:${campaign.id}`, level: "campaign", parentId: null,
      campaignId: campaign.id, effectiveStatus: null });
    knownCampaigns.add(key);
  }
  // Account identity comes from the authenticated account catalog, never from
  // a stale hierarchy row. This prevents campaigns from one Meta account being
  // displayed under another client's/account's label.
  const accountCatalog = new Map(analytics.accounts.map(account => [account.id, account]));
  for (const entity of entities) {
    const account = accountCatalog.get(entity.accountId);
    if (!account) continue;
    entity.accountName = account.name;
    entity.currency = account.currency;
  }
  // Entidades com linha confirmada pela coleta do período (RPC da hierarquia ou campanha com gasto no agregado).
  const confirmed = new Set(entities.map(entity => `${entity.accountId}:${entity.key}`));
  try {
    const thumbnails: Record<string, string> = {};
    const catalog: LiveCampaignIdentity[] = [];
    const statuses = await (input.readLive ?? getMetaEntityStatuses)({
      agencyId: input.agencyId,
      clientId: input.clientId,
      accountIds: input.accountIds,
      entities: entities.map(entity => ({ accountId: entity.accountId, key: entity.key })),
    }, thumbnails, catalog, input.rawStates, input.report);
    for (const campaign of catalog) {
      const account = analytics.accounts.find(a => a.id === campaign.accountId);
      if (!account || entities.some(e => e.accountId === campaign.accountId && e.level === "campaign" && e.id === campaign.id)) continue;
      entities.push({ key: `campaign:${campaign.id}`, id: campaign.id, name: campaign.name, level: "campaign",
        accountId: account.id, accountName: account.name, currency: account.currency, parentId: null,
        campaignId: campaign.id,
        // Campanha do catálogo ao vivo sem linha de métricas. Painel: zero SÓ com a resposta completa e confirmada do período (a Meta omite
        // entidades sem entrega). Campanhas (catálogo completo ou somente catálogo): o agregado da CONTA nunca prova zero para uma entidade;
        // fica desconhecida (sem valores), em qualquer caminho.
        values: !input.catalogOnly && !input.fullCatalog && analytics.metaAggregate?.confirmed
          ? confirmedEmptyPeriodValues(analytics.metrics.filter(m => m.key.startsWith("action:")).map(m => m.key.slice(7)))
          : {}, effectiveStatus: null });
    }
    if ((input.fullCatalog || input.catalogOnly) && input.report) {
      const known = new Set(entities.map(entity => `${entity.accountId}:${entity.key}`));
      for (const level of ["campaign", "adset", "ad"] as const) for (const item of input.report.entities.filter(entity => entity.level === level)) {
        const account = analytics.accounts.find(a => a.id === item.accountId);
        const key = `${item.level}:${item.id}`;
        if (!account || known.has(`${item.accountId}:${key}`)) continue;
        entities.push({ key, id: item.id, level: item.level, name: item.name, parentId: item.parentId, campaignId: item.campaignId,
          accountId: account.id, accountName: account.name, currency: account.currency, values: {}, effectiveStatus: null });
        known.add(`${item.accountId}:${key}`);
      }
      // Ausência de linha NÃO prova investimento zero: a consulta da hierarquia só devolve entidades com entrega ou ações e não garante
      // que cada nível foi coletado. O que não veio de uma linha confirmada fica sem valores (desconhecido), nunca zerado.
      for (const entity of entities) if (!confirmed.has(`${entity.accountId}:${entity.key}`)) entity.values = {};
    }
    return { success: true as const, entities: visible(entities.map(entity => ({
      ...entity,
      effectiveStatus: statuses[`${entity.accountId}:${entity.key}`] ?? null,
      thumbnailUrl: thumbnails[`${entity.accountId}:${entity.key}`] ?? entity.thumbnailUrl,
    }))) };
  } catch {
    return { success: true as const, entities: visible(entities.map(entity => ({ ...entity, effectiveStatus: null }))) };
  }
}

