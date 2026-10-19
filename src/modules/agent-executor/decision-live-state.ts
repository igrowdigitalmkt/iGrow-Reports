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
  /** Conta de anuncios dona da entidade segundo a Meta (`act_...`), para conferir titularidade. */
  accountExternalId: string | null;
};
export type LiveStateDeps = {
  tokenLoader?: typeof loadAccessToken;
  apiVersion?: string;
  fetchImpl?: MetaFetch;
};

export type LiveReadFailure = "account_missing" | "connection_missing" | "integration_offline" | "no_api_version" | "token_failed" | "meta_error";
export type LiveReadResult =
  | { ok: true; state: Map<string, LiveEntityState> }
  | { ok: false; reason: LiveReadFailure; detail?: string };

/**
 * Leitura (somente GET) do estado e orcamento atuais das entidades na Meta.
 * Orcamento diario so existe no nivel em que foi definido; ausente => null
 * (nunca presumido). O token nao sai deste modulo; a falha informa apenas um codigo curto.
 */
export async function readLiveEntityStateDetailed(
  service: SupabaseClient<Database>,
  scope: { agencyId: string; clientId: string; adAccountId: string },
  metaIds: string[],
  deps: LiveStateDeps = {},
): Promise<LiveReadResult> {
  const { data: account } = await service.from("meta_ad_accounts").select("meta_connection_id,external_id")
    .eq("agency_id", scope.agencyId).eq("id", scope.adAccountId).is("archived_at", null).maybeSingle();
  if (!account) return { ok: false, reason: "account_missing" };
  const { data: connection } = await service.from("meta_connections").select("id,integration_id,connected_at")
    .eq("agency_id", scope.agencyId).eq("client_id", scope.clientId).eq("id", account.meta_connection_id).maybeSingle();
  if (!connection?.connected_at) return { ok: false, reason: "connection_missing" };
  const { data: integration } = await service.from("integrations").select("id,connection_status,health_status")
    .eq("agency_id", scope.agencyId).eq("id", connection.integration_id).eq("provider", "meta").maybeSingle();
  if (integration?.connection_status !== "connected" || integration.health_status === "error") return { ok: false, reason: "integration_offline" };
  const apiVersion = deps.apiVersion ?? getMetaApiConfig()?.apiVersion;
  if (!apiVersion) return { ok: false, reason: "no_api_version" };
  let token: string;
  try {
    token = await (deps.tokenLoader ?? loadAccessToken)(service, scope.agencyId, integration.id, connection.id);
  } catch { return { ok: false, reason: "token_failed" }; }
  try {
    const client = new MetaClient({ accessToken: token, apiVersion, fetchImpl: deps.fetchImpl, timeoutMs: 25_000, retryDelayMs: 1_000 });
    // Leitura pela conta: titularidade garantida e id inexistente nao derruba tudo.
    const { campaigns, adsets } = await client.listEntityStates(account.external_id);
    const wanted = new Set(metaIds);
    const state = new Map<string, LiveEntityState>();
    for (const o of [...campaigns, ...adsets]) {
      if (!wanted.has(o.id)) continue;
      const budget = typeof o.daily_budget === "string" && /^\d{1,15}$/.test(o.daily_budget) ? Number(o.daily_budget)
        : typeof o.daily_budget === "number" && Number.isSafeInteger(o.daily_budget) ? o.daily_budget : null;
      state.set(o.id, { configuredStatus: o.status ?? null, effectiveStatus: o.effective_status ?? null, dailyBudgetMinor: budget, accountExternalId: account.external_id });
    }
    return { ok: true, state };
  } catch (error) {
    // Somente o codigo numerico da Meta e o status HTTP; nunca a mensagem, a URL ou o token.
    const e = error as { code?: unknown; httpStatus?: unknown };
    return { ok: false, reason: "meta_error", detail: `http ${typeof e.httpStatus === "number" ? e.httpStatus : "?"} code ${typeof e.code === "number" ? e.code : "?"}` };
  }
}

export async function readLiveEntityState(
  service: SupabaseClient<Database>,
  scope: { agencyId: string; clientId: string; adAccountId: string },
  metaIds: string[],
  deps: LiveStateDeps = {},
): Promise<Map<string, LiveEntityState> | null> {
  const result = await readLiveEntityStateDetailed(service, scope, metaIds, deps);
  return result.ok ? result.state : null;
}
