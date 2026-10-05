import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { META_ANALYTICS_MAX_AGE_MS, META_DETAIL_RETENTION_DAYS } from "./analytics-contract";

export type RetentionResult = { detailInsights: number; detailActions: number; aggregateScopes: number; cutoff: string };

// Keeps the free-plan database within its storage limit: ad set and ad daily
// rows older than the retention window are removed (accounts and campaigns keep
// full history; Meta still holds up to 37 months if detail is ever needed again),
// and exact-period aggregates past twice their validity are dropped.
export async function pruneMetaHistory(service: SupabaseClient<Database>, now = new Date()): Promise<RetentionResult> {
  const cutoff = new Date(now.getTime() - META_DETAIL_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data: accounts, error } = await service.from("meta_ad_accounts").select("agency_id,id");
  if (error) throw new Error("Não foi possível listar as contas para a retenção.");
  const result: RetentionResult = { detailInsights: 0, detailActions: 0, aggregateScopes: 0, cutoff };
  // One account at a time keeps each delete small on a shared database.
  for (const account of accounts ?? []) {
    const actions = await service.from("meta_daily_actions").delete({ count: "exact" })
      .eq("agency_id", account.agency_id).eq("ad_account_id", account.id).in("level", ["adset", "ad"]).lt("insight_date", cutoff);
    if (actions.error) throw new Error("Não foi possível aplicar a retenção das ações.");
    const insights = await service.from("meta_daily_insights").delete({ count: "exact" })
      .eq("agency_id", account.agency_id).eq("ad_account_id", account.id).in("level", ["adset", "ad"]).lt("insight_date", cutoff);
    if (insights.error) throw new Error("Não foi possível aplicar a retenção dos detalhes.");
    result.detailActions += actions.count ?? 0;
    result.detailInsights += insights.count ?? 0;
  }
  const scopes = await service.from("meta_dashboard_scopes").delete({ count: "exact" })
    .lt("collected_at", new Date(now.getTime() - 2 * META_ANALYTICS_MAX_AGE_MS).toISOString());
  if (scopes.error) throw new Error("Não foi possível remover agregados vencidos.");
  result.aggregateScopes = scopes.count ?? 0;
  return result;
}
