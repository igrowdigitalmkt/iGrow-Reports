import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptServerSecret,
  encryptServerSecret,
  type EncryptedSecret,
} from "@/lib/crypto";
import { getMetaApiConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
import {
  hasMetaAdsReadPermission,
  hasBusinessPortfolio,
  MetaApiError,
  MetaClient,
  type MetaAdAccount,
} from "./client";
import { normalizeInsightSlice, periodInsightMetrics, splitCollectionRange, validateCollectionRange } from "./collection";

const TOKEN_KIND = "meta_access_token";

// Called only after the dashboard has authorized access to this client.
export async function getMetaEntityStatuses(input: { agencyId: string; clientId: string; accountIds: string[] }): Promise<Record<string, string>> {
  const statuses: Record<string, string> = {};
  if (!input.accountIds.length) return statuses;
  try {
    const { service, apiVersion } = operationalDependencies();
    const { integration, connection } = await getStoredConnection(service, input.agencyId, input.clientId);
    const { data: links, error: linkError } = await service.from("client_ad_accounts").select("ad_account_id")
      .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("active", true).in("ad_account_id", input.accountIds);
    if (linkError || links?.length !== input.accountIds.length) return statuses;
    const { data: accounts, error } = await service.from("meta_ad_accounts").select("id,external_id")
      .eq("agency_id", input.agencyId).eq("meta_connection_id", connection.id).in("id", input.accountIds).is("archived_at", null);
    if (error || !accounts) return statuses;
    const token = await loadAccessToken(service, input.agencyId, integration.id, connection.id);
    const client = new MetaClient({ accessToken: token, apiVersion });
    await Promise.allSettled(accounts.map(async account => {
      const results = await Promise.allSettled([client.listCampaigns(account.external_id), client.listAdSets(account.external_id), client.listAds(account.external_id)]);
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const level = ["campaign", "adset", "ad"][index];
        for (const entity of result.value) if (entity.effective_status) statuses[`${account.id}:${level}:${entity.id}`] = entity.effective_status;
      });
    }));
  } catch { /* A Meta outage must not mislabel entities or block historical analytics. */ }
  return statuses;
}

function connectionTokenKind(connectionId: string) {
  return `${TOKEN_KIND}:${connectionId}`;
}

export class MetaSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaSetupError";
  }
}

function operationalDependencies() {
  const service = createSupabaseServiceClient();
  const meta = getMetaApiConfig();
  if (!service) {
    throw new MetaSetupError("O acesso privilegiado ao Supabase não está configurado.");
  }
  if (!meta) {
    throw new MetaSetupError("A versão da Meta Graph API não está configurada.");
  }
  return { service, apiVersion: meta.apiVersion };
}

function secretAad(agencyId: string, integrationId: string, connectionId: string) {
  return `igrow-reports:${agencyId}:${integrationId}:${connectionTokenKind(connectionId)}`;
}

async function storeAccessToken(
  service: SupabaseClient<Database>,
  agencyId: string,
  integrationId: string,
  connectionId: string,
  accessToken: string,
) {
  const encrypted = encryptServerSecret(
    accessToken,
    secretAad(agencyId, integrationId, connectionId),
  );
  const { error } = await service.rpc("upsert_integration_secret", {
    p_agency_id: agencyId,
    p_integration_id: integrationId,
    p_secret_kind: connectionTokenKind(connectionId),
    p_key_id: encrypted.keyId,
    p_nonce_b64: encrypted.nonceB64,
    p_ciphertext_b64: encrypted.ciphertextB64,
    p_auth_tag_b64: encrypted.authTagB64,
  });
  if (error) throw new MetaSetupError("Não foi possível armazenar a credencial Meta com segurança.");
}

async function loadAccessToken(
  service: SupabaseClient<Database>,
  agencyId: string,
  integrationId: string,
  connectionId: string,
) {
  const { data, error } = await service.rpc("get_integration_secret", {
    p_agency_id: agencyId,
    p_integration_id: integrationId,
    p_secret_kind: connectionTokenKind(connectionId),
  }).single();

  if (error || !data) {
    throw new MetaSetupError(
      "A credencial Meta deste cliente não está disponível. Atualize a credencial para continuar.",
    );
  }

  const envelope: EncryptedSecret = {
    keyId: data.key_id,
    nonceB64: data.nonce_b64,
    ciphertextB64: data.ciphertext_b64,
    authTagB64: data.auth_tag_b64,
  };
  return decryptServerSecret(envelope, secretAad(agencyId, integrationId, connectionId));
}

async function syncAccounts(
  service: SupabaseClient<Database>,
  agencyId: string,
  connectionId: string,
  accounts: MetaAdAccount[],
) {
  const syncedAt = new Date().toISOString();
  const { data: existing, error: existingError } = await service
    .from("meta_ad_accounts")
    .select("id,external_id")
    .eq("agency_id", agencyId)
    .eq("meta_connection_id", connectionId);
  if (existingError) throw new MetaSetupError("Não foi possível consultar as contas Meta já sincronizadas.");

  for (const account of accounts) {
    if (!account.id || !account.name || !account.currency || !account.timezone_name) {
      throw new MetaSetupError("A Meta retornou uma conta de anúncios sem os metadados obrigatórios.");
    }
    if (!hasBusinessPortfolio(account)) {
      throw new MetaSetupError("Contas de anúncios sem portfólio empresarial não são permitidas.");
    }
  }

  if (accounts.length) {
    const { data: conflicts, error: conflictError } = await service
      .from("meta_ad_accounts")
      .select("id")
      .eq("agency_id", agencyId)
      .in("external_id", accounts.map((account) => account.id))
      .neq("meta_connection_id", connectionId);
    if (conflictError) throw new MetaSetupError("Não foi possível validar a propriedade das contas Meta.");
    if (conflicts?.length) {
      throw new MetaSetupError("Uma conta retornada pela Meta já pertence à conexão de outro cliente.");
    }
    const rows = accounts.map((account) => ({
      agency_id: agencyId,
      meta_connection_id: connectionId,
      external_id: account.id,
      name: account.name,
      currency: account.currency.toUpperCase(),
      timezone_name: account.timezone_name,
      account_status: account.account_status === undefined
        ? null
        : String(account.account_status),
      business_name: account.business?.name ?? null,
      business_id: account.business!.id!,
      archived_at: null,
      last_synced_at: syncedAt,
    }));
    const { error } = await service
      .from("meta_ad_accounts")
      .upsert(rows, { onConflict: "agency_id,external_id" });
    if (error) throw new MetaSetupError("Não foi possível persistir as contas de anúncios sincronizadas.");
  }

  const currentIds = new Set(accounts.map((account) => account.id));
  for (const previous of existing ?? []) {
    if (!currentIds.has(previous.external_id)) {
      const { error } = await service
        .from("meta_ad_accounts")
        .update({ archived_at: syncedAt, updated_at: syncedAt })
        .eq("agency_id", agencyId)
        .eq("id", previous.id);
      if (error) throw new MetaSetupError("Não foi possível atualizar uma conta Meta que perdeu acesso.");
    }
  }

  return { count: accounts.length, syncedAt };
}

async function linkConnectionAccountsToClient(
  service: SupabaseClient<Database>,
  agencyId: string,
  clientId: string,
  connectionId: string,
  actorId: string,
) {
  const { data: accounts, error } = await service
    .from("meta_ad_accounts")
    .select("id,archived_at")
    .eq("agency_id", agencyId)
    .eq("meta_connection_id", connectionId);
  if (error) throw new MetaSetupError("Não foi possível associar as contas Meta ao cliente.");

  const rows = (accounts ?? []).map((account) => ({
    agency_id: agencyId,
    client_id: clientId,
    ad_account_id: account.id,
    active: account.archived_at === null,
    created_by: actorId,
  }));
  if (!rows.length) return;

  const { error: linkError } = await service
    .from("client_ad_accounts")
    .upsert(rows, { onConflict: "agency_id,client_id,ad_account_id" });
  if (linkError) throw new MetaSetupError("Não foi possível associar as contas Meta ao cliente.");
}

async function getStoredConnection(
  service: SupabaseClient<Database>,
  agencyId: string,
  clientId: string,
) {
  const { data: integration, error: integrationError } = await service
    .from("integrations")
    .select("id,connection_status,health_status")
    .eq("agency_id", agencyId)
    .eq("provider", "meta")
    .single();
  if (integrationError || !integration) {
    throw new MetaSetupError("A integração Meta ainda não foi configurada.");
  }

  const { data: connections, error: connectionError } = await service
    .from("meta_connections")
    .select("id,external_user_id")
    .eq("agency_id", agencyId)
    .eq("integration_id", integration.id)
    .eq("client_id", clientId)
    .order("created_at")
    .limit(1);
  const connection = connections?.[0];
  if (connectionError || !connection) {
    throw new MetaSetupError("Este cliente ainda não possui uma conexão Meta.");
  }

  return { integration, connection };
}

async function markIntegrationFailure(
  service: SupabaseClient<Database>,
  agencyId: string,
  integrationId: string,
  error: unknown,
) {
  const code = error instanceof MetaApiError && error.code !== null
    ? String(error.code)
    : "internal";
  await service
    .from("integrations")
    .update({
      health_status: "error",
      last_checked_at: new Date().toISOString(),
      last_error_at: new Date().toISOString(),
      last_error_code: code,
    })
    .eq("agency_id", agencyId)
    .eq("id", integrationId);
}

export async function connectMetaForClient(input: {
  agencyId: string;
  clientId: string;
  actorId: string;
  accessToken: string;
}) {
  const { service, apiVersion } = operationalDependencies();
  const client = new MetaClient({
    accessToken: input.accessToken,
    apiVersion,
  });

  const [identity, permissions] = await Promise.all([
    client.validateConnection(),
    client.listPermissions(),
  ]);
  const accounts = await client.listAdAccounts(identity.id);
  const grantedScopes = permissions
    .filter((permission) => permission.status === "granted")
    .map((permission) => permission.permission);

  if (!hasMetaAdsReadPermission(grantedScopes)) {
    throw new MetaSetupError(
      "A credencial Meta precisa da permissão ads_read para consultar o desempenho dos anúncios.",
    );
  }

  const now = new Date().toISOString();
  const { data: integration, error: integrationError } = await service
    .from("integrations")
    .upsert({
      agency_id: input.agencyId,
      provider: "meta",
      connection_status: "connected",
      health_status: accounts.length ? "healthy" : "degraded",
      last_checked_at: now,
      last_success_at: now,
      last_error_at: null,
      last_error_code: null,
      created_by: input.actorId,
      updated_at: now,
    }, { onConflict: "agency_id,provider" })
    .select("id")
    .single();
  if (integrationError || !integration) {
    throw new MetaSetupError("Não foi possível registrar a integração Meta.");
  }

  const { data: existingConnections, error: existingConnectionError } = await service
    .from("meta_connections")
    .select("id")
    .eq("agency_id", input.agencyId)
    .eq("integration_id", integration.id)
    .eq("client_id", input.clientId)
    .order("created_at")
    .limit(1);
  if (existingConnectionError) {
    throw new MetaSetupError("Não foi possível consultar a conexão Meta do cliente.");
  }

  const connectionPayload = {
    agency_id: input.agencyId,
    integration_id: integration.id,
    client_id: input.clientId,
    external_user_id: identity.id,
    scopes: grantedScopes,
    metadata: { identity_name: identity.name ?? null },
    connected_at: now,
    last_accounts_sync_at: now,
    updated_at: now,
  };
  const existingConnection = existingConnections?.[0];
  const connectionQuery = existingConnection
    ? service.from("meta_connections").update(connectionPayload)
        .eq("agency_id", input.agencyId).eq("id", existingConnection.id)
    : service.from("meta_connections").insert(connectionPayload);
  const { data: connection, error: connectionError } = await connectionQuery
    .select("id")
    .single();
  if (connectionError || !connection) {
    throw new MetaSetupError("Não foi possível registrar a conexão Meta do cliente.");
  }

  await storeAccessToken(
    service,
    input.agencyId,
    integration.id,
    connection.id,
    input.accessToken,
  );
  const synced = await syncAccounts(
    service,
    input.agencyId,
    connection.id,
    accounts,
  );
  await linkConnectionAccountsToClient(
    service,
    input.agencyId,
    input.clientId,
    connection.id,
    input.actorId,
  );

  await service.from("audit_logs").insert({
    agency_id: input.agencyId,
    actor_id: input.actorId,
    action: "meta.connected",
    entity_id: integration.id,
    metadata: {
      account_count: synced.count,
      api_version: apiVersion,
      granted_scopes: grantedScopes,
    },
  });

  return {
    accountCount: synced.count,
    apiVersion,
    identityName: identity.name ?? null,
    scopes: grantedScopes,
    healthStatus: accounts.length ? "healthy" as const : "degraded" as const,
  };
}

export async function syncMetaAccountsForClient(input: {
  agencyId: string;
  clientId: string;
  actorId: string;
}) {
  const { service, apiVersion } = operationalDependencies();
  const { integration, connection } = await getStoredConnection(service, input.agencyId, input.clientId);
  const token = await loadAccessToken(service, input.agencyId, integration.id, connection.id);
  const client = new MetaClient({ accessToken: token, apiVersion });

  try {
    const accounts = await client.listAdAccounts(connection.external_user_id ?? undefined);
    const synced = await syncAccounts(
      service,
      input.agencyId,
      connection.id,
      accounts,
    );
    await linkConnectionAccountsToClient(
      service,
      input.agencyId,
      input.clientId,
      connection.id,
      input.actorId,
    );
    await service.from("meta_connections")
      .update({ last_accounts_sync_at: synced.syncedAt, updated_at: synced.syncedAt })
      .eq("agency_id", input.agencyId)
      .eq("id", connection.id);
    await service.from("integrations")
      .update({
        connection_status: "connected",
        health_status: accounts.length ? "healthy" : "degraded",
        last_checked_at: synced.syncedAt,
        last_success_at: synced.syncedAt,
        last_error_at: null,
        last_error_code: null,
      })
      .eq("agency_id", input.agencyId)
      .eq("id", integration.id);
    await service.from("audit_logs").insert({
      agency_id: input.agencyId,
      actor_id: input.actorId,
      action: "meta.accounts_synced",
      entity_id: integration.id,
      metadata: { account_count: synced.count, api_version: apiVersion },
    });
    return { accountCount: synced.count };
  } catch (error) {
    await markIntegrationFailure(service, input.agencyId, integration.id, error);
    throw error;
  }
}

export async function collectMetaClientInsights(input: {
  agencyId: string;
  clientId: string;
  actorId: string;
  since: string;
  until: string;
  forceRefresh?: boolean;
}) {
  validateCollectionRange(input.since, input.until);
  const { service, apiVersion } = operationalDependencies();
  const { integration, connection } = await getStoredConnection(service, input.agencyId, input.clientId);
  const token = await loadAccessToken(service, input.agencyId, integration.id, connection.id);
  const client = new MetaClient({ accessToken: token, apiVersion });

  const { data: links, error: linksError } = await service
    .from("client_ad_accounts")
    .select("ad_account_id")
    .eq("agency_id", input.agencyId)
    .eq("client_id", input.clientId)
    .eq("active", true);
  if (linksError) throw new MetaSetupError("Não foi possível consultar as contas do cliente.");

  const accountIds = (links ?? []).map((link) => link.ad_account_id);
  if (!accountIds.length) {
    throw new MetaSetupError("Associe ao menos uma conta Meta ao cliente antes da coleta.");
  }

  const { data: accounts, error: accountsError } = await service
    .from("meta_ad_accounts")
    .select("id,external_id,currency,timezone_name")
    .eq("agency_id", input.agencyId)
    .eq("meta_connection_id", connection.id)
    .in("id", accountIds)
    .is("archived_at", null);
  if (accountsError || !accounts?.length || accounts.length !== accountIds.length) {
    throw new MetaSetupError("As contas Meta associadas não estão disponíveis.");
  }

  let insightCount = 0;
  let actionCount = 0;
  let granularInsightCount = 0;
  let granularActionCount = 0;
  let completedSliceCount = 0;
  let reusedSliceCount = 0;
  const failures: Array<{ accountId: string; since: string; until: string; scope: "daily" | "period" | "account"; code: string }> = [];
  const slices = splitCollectionRange(input.since, input.until);
  const historicalCutoff = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);

  async function recordFailure(accountId: string, slice: { since: string; until: string }, error: unknown, scope: "daily" | "account") {
    const code = error instanceof MetaApiError ? String(error.code ?? error.httpStatus) : "persistence_or_validation";
    failures.push({ accountId, ...slice, scope, code });
    // A failed request never replaces the previously collected rows.
    const { error: runError } = await service.from("meta_collection_runs").upsert({
      agency_id: input.agencyId,
      client_id: input.clientId,
      ad_account_id: accountId,
      date_from: slice.since,
      date_to: slice.until,
      status: "failed",
      insight_count: 0,
      action_count: 0,
      levels: [],
      collected_at: new Date().toISOString(),
      error_code: code,
    }, { onConflict: "agency_id,ad_account_id,date_from,date_to" });
    if (runError) throw new MetaSetupError("Não foi possível registrar a falha da coleta. Os lotes concluídos foram preservados.");
  }

  try {
    const permissions = await client.listPermissions();
    if (!hasMetaAdsReadPermission(permissions.filter((permission) => permission.status === "granted").map((permission) => permission.permission))) {
      throw new MetaSetupError("A credencial Meta precisa da permissão ads_read para atualizar os dados.");
    }
    for (const account of accounts) {
      let liveAccount: MetaAdAccount;
      try {
        liveAccount = await client.getAdAccount(account.external_id);
        if (!hasBusinessPortfolio(liveAccount)) {
          throw new MetaSetupError("A Meta não confirmou um portfólio empresarial para esta conta. A coleta foi bloqueada.");
        }
        if (liveAccount.currency !== account.currency || liveAccount.timezone_name !== account.timezone_name) {
          throw new MetaSetupError("Os metadados da conta mudaram na Meta. Sincronize as contas antes de coletar.");
        }
        const { error: metadataError } = await service.from("meta_ad_accounts")
          .update({ business_id: liveAccount.business!.id!, business_name: liveAccount.business?.name ?? null })
          .eq("agency_id", input.agencyId).eq("id", account.id);
        if (metadataError) throw new MetaSetupError("Não foi possível registrar o portfólio empresarial da conta.");
      } catch (error) {
        await recordFailure(account.id, slices[0], error, "account");
        continue;
      }
      const { data: previousRuns, error: runError } = await service.from("meta_collection_runs")
        .select("date_from,date_to,insight_count,action_count,levels")
        .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("ad_account_id", account.id)
        .eq("status", "complete").gte("date_from", input.since).lte("date_to", input.until);
      if (runError) throw new MetaSetupError("Não foi possível consultar o histórico das coletas.");
      const completeRuns = new Map((previousRuns ?? []).map((run) => [`${run.date_from}:${run.date_to}`, run]));
      let allDailyComplete = true;
      for (const slice of slices) {
        const previous = completeRuns.get(`${slice.since}:${slice.until}`);
        const canReuse = !input.forceRefresh && previous && slice.until < historicalCutoff
          && ['account', 'campaign', 'adset', 'ad'].every(level => previous.levels.includes(level));
        if (canReuse && previous) {
          insightCount += previous.insight_count;
          actionCount += previous.action_count;
          completedSliceCount += 1;
          reusedSliceCount += 1;
          continue;
        }
        try {
          const [accountInsights, campaignInsights, adsetInsights, adInsights] = await Promise.all([
            client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "account" }),
            client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "campaign" }),
            client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "adset" }),
            client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "ad" }),
          ]);
          const collectedAt = new Date().toISOString();
          const normalized = normalizeInsightSlice({
            agencyId: input.agencyId,
            accountId: account.id,
            externalAccountId: account.external_id,
            ...slice,
            timezoneName: liveAccount.timezone_name,
            businessId: liveAccount.business!.id!,
            apiVersion,
            collectedAt,
            accountInsights,
            campaignInsights,
            adsetInsights,
            adInsights,
          });
          const { data: persisted, error: persistError } = await service.rpc("persist_meta_detailed_slice", {
            p_agency_id: input.agencyId,
            p_client_id: input.clientId,
            p_ad_account_id: account.id,
            p_date_from: slice.since,
            p_date_to: slice.until,
            p_insights: normalized.insights as Json,
            p_actions: normalized.actions as Json,
          }).single();
          if (persistError || !persisted) throw new MetaSetupError("Não foi possível persistir o lote de Insights e ações Meta.");

          insightCount += persisted.insight_count;
          actionCount += persisted.action_count;
          granularInsightCount += normalized.insights.filter(row => row.level === "adset" || row.level === "ad").length;
          granularActionCount += normalized.actions.filter(row => row.level === "adset" || row.level === "ad").length;
          completedSliceCount += 1;
        } catch (error) {
          await recordFailure(account.id, slice, error, "daily");
          allDailyComplete = false;
          // The next retry reuses old completed slices and resumes this account.
          break;
        }
      }
      if (allDailyComplete) {
        try {
          const periodInsights = await client.getPeriodInsights({ adAccountId: account.external_id, since: input.since, until: input.until });
          if (periodInsights.length > 1 || (periodInsights[0]?.account_id && `act_${periodInsights[0].account_id}` !== account.external_id)) {
            throw new MetaSetupError("A Meta retornou alcance agregado fora do escopo solicitado.");
          }
          const { error: periodError } = await service.from("meta_period_insights").upsert({
            agency_id: input.agencyId, client_id: input.clientId, ad_account_id: account.id,
            date_from: input.since, date_to: input.until,
            ...periodInsightMetrics(periodInsights[0]),
            api_version: apiVersion, collected_at: new Date().toISOString(),
            metadata: { timezone_name: liveAccount.timezone_name, business_id: liveAccount.business!.id!, no_delivery: periodInsights.length === 0 },
          }, { onConflict: "agency_id,ad_account_id,date_from,date_to" });
          if (periodError) throw new MetaSetupError("Não foi possível persistir o alcance único do período.");
        } catch (error) {
          failures.push({ accountId: account.id, since: input.since, until: input.until, scope: "period", code: error instanceof MetaApiError ? String(error.code ?? error.httpStatus) : "persistence_or_validation" });
        }
      }
    }

    const now = new Date().toISOString();
    await service.from("integrations")
      .update({
        health_status: failures.length ? "degraded" : "healthy",
        last_checked_at: now,
        last_success_at: now,
        last_error_at: failures.length ? now : null,
        last_error_code: failures[0]?.code ?? null,
      })
      .eq("agency_id", input.agencyId)
      .eq("id", integration.id);

    await service.from("audit_logs").insert({
      agency_id: input.agencyId,
      actor_id: input.actorId,
      action: "meta.insights_collected",
      entity_id: input.clientId,
      metadata: {
        since: input.since,
        until: input.until,
        account_count: accounts.length,
        insight_count: insightCount,
        action_count: actionCount,
        granular_insight_count: granularInsightCount,
        granular_action_count: granularActionCount,
        completed_slice_count: completedSliceCount,
        reused_slice_count: reusedSliceCount,
        failed_slice_count: failures.length,
        api_version: apiVersion,
      },
    });

    return {
      accountCount: accounts.length,
      insightCount,
      actionCount,
      granularInsightCount,
      granularActionCount,
      completedSliceCount,
      reusedSliceCount,
      failures,
      apiVersion,
    };
  } catch (error) {
    await markIntegrationFailure(service, input.agencyId, integration.id, error);
    throw error;
  }
}
