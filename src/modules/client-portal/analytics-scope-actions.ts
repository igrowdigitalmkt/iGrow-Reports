"use server";

import { z } from "zod";
import { requireClientDashboardAccess } from "./context";
import { normalizeClientAnalytics } from "./analytics-calculations";
import { getClientAnalytics } from "./analytics";
import { normalizeHierarchy, relevantCampaignHierarchy } from "./analytics-hierarchy";
import { getMetaEntityStatuses, refreshMetaDashboardScope, type LiveCampaignIdentity } from "@/modules/meta/server";

const inputSchema = z.object({
  clientId: z.uuid(), dateFrom: z.iso.date(), dateTo: z.iso.date(),
  accountIds: z.array(z.uuid()).min(1).max(100),
  entityKeys: z.array(z.string().regex(/^(campaign|adset|ad):\d+$/)).min(1).max(1000),
});

export async function getCampaignScopedAnalytics(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Seleção de campanhas inválida." };
  const { supabase, access } = await requireClientDashboardAccess(parsed.data.clientId);
  const { data, error } = await supabase.rpc("get_campaign_scoped_analytics", {
    p_client_id: parsed.data.clientId,
    p_date_from: parsed.data.dateFrom, p_date_to: parsed.data.dateTo,
    p_ad_account_ids: parsed.data.accountIds, p_entity_keys: parsed.data.entityKeys,
  });
  if (error || !data) return { error: "Não foi possível aplicar a seleção de campanhas. Confira a coleta do período." };
  const initial = normalizeClientAnalytics(data);
  if (initial.coverage.status !== "complete") {
    return { error: "A seleção de campanhas permanece bloqueada até todos os dias do período estarem completos." };
  }
  try { await refreshMetaDashboardScope({ agencyId: access.agencyId, clientId: parsed.data.clientId, data: initial, entityKeys: parsed.data.entityKeys }); }
  catch { return { error: "A Meta não confirmou os agregados desta seleção. Tente atualizar os dados e aplicar novamente." }; }
  const refreshed = await supabase.rpc("get_campaign_scoped_analytics", { p_client_id: parsed.data.clientId,
    p_date_from: parsed.data.dateFrom, p_date_to: parsed.data.dateTo, p_ad_account_ids: parsed.data.accountIds, p_entity_keys: parsed.data.entityKeys });
  const analytics = normalizeClientAnalytics(refreshed.data ?? data);
  return { success: true as const, summary: analytics.summary, previousSummary: analytics.previousSummary,
    daily: analytics.daily, previousDaily: analytics.previousDaily, coverage: analytics.coverage, estimatedMetricKeys: analytics.estimatedMetricKeys };
}

const hierarchyInputSchema = z.object({
  clientId: z.uuid(), dateFrom: z.iso.date(), dateTo: z.iso.date(),
  accountIds: z.array(z.uuid()).min(1).max(100),
});

export async function getClientAnalyticsHierarchy(input: unknown) {
  const parsed = hierarchyInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Período ou contas inválidos para carregar campanhas." };
  const { supabase, access } = await requireClientDashboardAccess(parsed.data.clientId);
  const analytics = await getClientAnalytics(supabase, parsed.data.clientId, parsed.data.dateFrom, parsed.data.dateTo, parsed.data.accountIds);
  if (analytics.coverage.status !== "complete") {
    return { error: "Campanhas e métricas permanecem ocultas até a coleta do período estar completa." };
  }
  const { data, error } = await supabase.rpc("get_client_analytics_hierarchy", {
    p_client_id: parsed.data.clientId,
    p_date_from: parsed.data.dateFrom,
    p_date_to: parsed.data.dateTo,
    p_ad_account_ids: parsed.data.accountIds,
  });
  if (error || !data) return { error: "Não foi possível carregar a árvore de campanhas deste período." };
  const entities = normalizeHierarchy(data);
  try {
    const thumbnails: Record<string, string> = {};
    const catalog: LiveCampaignIdentity[] = [];
    const statuses = await getMetaEntityStatuses({
      agencyId: access.agencyId,
      clientId: parsed.data.clientId,
      accountIds: parsed.data.accountIds,
      entities: entities.map(entity => ({ accountId: entity.accountId, key: entity.key })),
    }, thumbnails, catalog);
    for (const campaign of catalog) {
      const account = analytics.accounts.find(a => a.id === campaign.accountId);
      if (!account || entities.some(e => e.accountId === campaign.accountId && e.level === "campaign" && e.id === campaign.id)) continue;
      entities.push({ key: `campaign:${campaign.id}`, id: campaign.id, name: campaign.name, level: "campaign",
        accountId: account.id, accountName: account.name, currency: account.currency, parentId: null,
        campaignId: campaign.id, values: {}, effectiveStatus: null });
    }
    return { success: true as const, entities: relevantCampaignHierarchy(entities.map(entity => ({
      ...entity,
      effectiveStatus: statuses[`${entity.accountId}:${entity.key}`] ?? null,
      thumbnailUrl: thumbnails[`${entity.accountId}:${entity.key}`] ?? entity.thumbnailUrl,
    }))) };
  } catch {
    return { success: true as const, entities: relevantCampaignHierarchy(entities.map(entity => ({ ...entity, effectiveStatus: null }))) };
  }
}
