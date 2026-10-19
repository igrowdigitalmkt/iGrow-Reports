import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMetaApiConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { MetaClient, type MetaFetch } from "@/modules/meta/client";
import { loadAccessToken } from "@/modules/meta/server";

export type LiveEntityState = {
  /** Status configurado lido AGORA na Meta (nao do cache de metricas). */
  configuredStatus: string | null;
  effectiveStatus: string | null;
  dailyBudgetMinor: number | null;
};
export type LiveStateDeps = {
  tokenLoader?: typeof loadAccessToken;
  apiVersion?: string;
  fetchImpl?: MetaFetch;
};

/**
 * Leitura (somente GET) do estado e orcamento atuais das entidades na Meta.
 * Orcamento diario so existe no nivel em que foi definido; ausente => null
 * (nunca presumido). O token nao sai deste modulo.
 */
export async function readLiveEntityState(
  service: SupabaseClient<Database>,
  scope: { agencyId: string; clientId: string; adAccountId: string },
  metaIds: string[],
  deps: LiveStateDeps = {},
): Promise<Map<string, LiveEntityState> | null> {
  const { data: account } = await service.from("meta_ad_accounts").select("meta_connection_id")
    .eq("agency_id", scope.agencyId).eq("id", scope.adAccountId).is("archived_at", null).maybeSingle();
  if (!account) return null;
  const { data: connection } = await service.from("meta_connections").select("id,integration_id,connected_at")
    .eq("agency_id", scope.agencyId).eq("client_id", scope.clientId).eq("id", account.meta_connection_id).maybeSingle();
  if (!connection?.connected_at) return null;
  const { data: integration } = await service.from("integrations").select("id,connection_status,health_status")
    .eq("agency_id", scope.agencyId).eq("id", connection.integration_id).eq("provider", "meta").maybeSingle();
  if (integration?.connection_status !== "connected" || integration.health_status === "error") return null;
  const apiVersion = deps.apiVersion ?? getMetaApiConfig()?.apiVersion;
  if (!apiVersion) return null;
  try {
    const token = await (deps.tokenLoader ?? loadAccessToken)(service, scope.agencyId, integration.id, connection.id);
    const client = new MetaClient({ accessToken: token, apiVersion, fetchImpl: deps.fetchImpl, timeoutMs: 25_000, retryDelayMs: 1_000 });
    const objects = await client.getObjects<{ id?: string; status?: string; effective_status?: string; daily_budget?: string }>(
      metaIds, "id,status,effective_status,daily_budget");
    return new Map(objects.map(o => {
      const budget = o.daily_budget !== undefined && /^\d{1,15}$/.test(o.daily_budget) ? Number(o.daily_budget) : null;
      return [o.id, { configuredStatus: o.status ?? null, effectiveStatus: o.effective_status ?? null, dailyBudgetMinor: budget }];
    }));
  } catch { return null; }
}
