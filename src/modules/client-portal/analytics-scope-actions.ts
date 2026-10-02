"use server";

import { z } from "zod";
import { requireClientDashboardAccess } from "./context";
import { normalizeClientAnalytics } from "./analytics-calculations";
import { refreshMetaDashboardScope } from "@/modules/meta/server";

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
  try { await refreshMetaDashboardScope({ agencyId: access.agencyId, clientId: parsed.data.clientId, data: initial, entityKeys: parsed.data.entityKeys }); }
  catch { return { error: "A Meta não confirmou os agregados desta seleção. Tente atualizar os dados e aplicar novamente." }; }
  const refreshed = await supabase.rpc("get_campaign_scoped_analytics", { p_client_id: parsed.data.clientId,
    p_date_from: parsed.data.dateFrom, p_date_to: parsed.data.dateTo, p_ad_account_ids: parsed.data.accountIds, p_entity_keys: parsed.data.entityKeys });
  const analytics = normalizeClientAnalytics(refreshed.data ?? data);
  return { success: true as const, summary: analytics.summary, previousSummary: analytics.previousSummary,
    daily: analytics.daily, previousDaily: analytics.previousDaily, coverage: analytics.coverage };
}
