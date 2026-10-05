import { campaignResultTotals } from "./result-values";
import "server-only";
import { selectedMetaAccounts } from "./login-config";
import { createHash } from "node:crypto";
import type { AnalyticsDashboardData, AnalyticsMetric, AnalyticsValues } from "@/modules/client-portal/analytics-types";
import { metaMetricLabel } from "./metric-labels";

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
  type MetaInsight,
} from "./client";
import { coveringCollectionRun, normalizeInsightSlice, periodInsightMetrics, splitCollectionRange, validateCollectionRange } from "./collection";

import { liveDeliveryStatuses } from "./delivery";
import { META_ANALYTICS_MAX_AGE_MS, META_ANALYTICS_VERSION, META_ATTRIBUTION_REFRESH_DAYS } from "./analytics-contract";
import { applyProviderResults, hasOverlappingMetaSelection, insightActionTypes, periodInsightValues, selectedPeriodInsightRows, sumPeriodInsightValues } from "./insight-values";

const TOKEN_KIND = "meta_access_token";

export async function loadMetaWorkerContext(service: SupabaseClient<Database>, identity: import("../integrations/data-contract").CollectionIdentity) {
  const { data: owner, error: ownerError } = await service.from("clients").select("agency_id").eq("id", identity.clientId).is("archived_at", null).single();
  if (ownerError || !owner) throw new MetaSetupError("Cliente indisponível para coleta.");
  const { integration, connection } = await getStoredConnection(service, owner.agency_id, identity.clientId);
  if (connection.id !== identity.connectionId) throw new MetaSetupError("Conexão fora do escopo da coleta.");
  const { data: account, error: accountError } = await service.from("meta_ad_accounts").select("currency,timezone_name")
    .eq("agency_id", owner.agency_id).eq("meta_connection_id", connection.id).eq("external_id", identity.externalAccountId).is("archived_at", null).single();
  if (accountError || !account) throw new MetaSetupError("Conta indisponível para coleta.");
  const accessToken = await loadAccessToken(service, owner.agency_id, integration.id, connection.id);
  return { client: new MetaClient({ accessToken, apiVersion: identity.apiVersion, timeoutMs: 25_000, retryDelayMs: 1_000 }), currency: account.currency, timezone: account.timezone_name };
}

// The caller first obtains data through the authenticated, client-scoped RPC.
export async function refreshMetaDashboardScope(input: { agencyId: string; clientId: string; data: AnalyticsDashboardData; entityKeys?: string[] }) {
  const { data } = input;
  const keys = [...new Set(input.entityKeys ?? [])];
  if (!data.selectedAccountIds.length) return { confirmed: false as const };
  const scopeKey = createHash("md5").update([...data.selectedAccountIds].sort().join(",") + "|" + [...keys].sort().join(",")).digest("hex");
  const { service, apiVersion } = operationalDependencies();
  const { data: cached, error: cacheError } = await service.from("meta_dashboard_scopes").select("collected_at,payload")
    .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("scope_key", scopeKey)
    .eq("date_from", data.dateFrom).eq("date_to", data.dateTo).maybeSingle();
  if (cacheError) throw new MetaSetupError("Não foi possível validar os agregados da Meta.");
  if (cached && Date.now() >= Date.parse(cached.collected_at) && Date.now() - Date.parse(cached.collected_at) < META_ANALYTICS_MAX_AGE_MS
    && cached.payload && typeof cached.payload === "object" && !Array.isArray(cached.payload) && cached.payload.version === META_ANALYTICS_VERSION
    && Date.parse(data.coverage.latestCollectedAt ?? "1970-01-01") <= Date.parse(cached.collected_at)) {
    const actionTypes = Array.isArray(cached.payload.actionTypes) ? cached.payload.actionTypes.filter((value): value is string => typeof value === "string") : [];
    return { confirmed: true as const, cached: true as const, version: META_ANALYTICS_VERSION, collectedAt: cached.collected_at, actionTypes };
  }
  const { integration, connection } = await getStoredConnection(service, input.agencyId, input.clientId);
  const { data: links } = await service.from("client_ad_accounts").select("ad_account_id")
    .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("active", true).in("ad_account_id", data.selectedAccountIds);
  if (links?.length !== data.selectedAccountIds.length) throw new MetaSetupError("Contas fora do escopo autorizado.");
  const { data: accounts } = await service.from("meta_ad_accounts").select("id,external_id")
    .eq("agency_id", input.agencyId).eq("meta_connection_id", connection.id).in("id", data.selectedAccountIds).is("archived_at", null);
  if (accounts?.length !== data.selectedAccountIds.length) throw new MetaSetupError("Contas indisponíveis.");
  const token = await loadAccessToken(service, input.agencyId, integration.id, connection.id);
  const client = new MetaClient({ accessToken: token, apiVersion, timeoutMs: 25_000, retryDelayMs: 1_000 });
  const resolvedKeys = new Set<string>();
  const levels = ["campaign", "adset", "ad"] as const;
  const validateRows = (rows: MetaInsight[], externalAccountId: string, since: string, until: string, level: "account" | typeof levels[number]) => {
    const ids = new Set<string>();
    for (const row of rows) {
      const id = level === "account" ? row.account_id : row[level + "_id"];
      if (!id || typeof id !== "string" || !/^\d+$/.test(id)
        || "act_" + row.account_id !== externalAccountId || row.date_start !== since || row.date_stop !== until || ids.has(id)) {
        throw new MetaSetupError("A Meta retornou um agregado fora da conta, do nível ou do período solicitado.");
      }
      if (level === "adset" && (typeof row.campaign_id !== "string" || !/^\d+$/.test(row.campaign_id))
        || level === "ad" && (typeof row.adset_id !== "string" || !/^\d+$/.test(row.adset_id)
          || typeof row.campaign_id !== "string" || !/^\d+$/.test(row.campaign_id))) {
        throw new MetaSetupError("A Meta não confirmou a hierarquia deste agregado.");
      }
      ids.add(id);
    }
    if (level === "account" && rows.length > 1) throw new MetaSetupError("A Meta não retornou um agregado único por conta.");
  };
  const periods = await Promise.all(accounts.map(async account => {
    let adIds: string[] | undefined;
    if (keys.length) {
      const ads = await client.listAds(account.external_id);
      for (let offset = 0; ; offset += 1000) {
        const { data: history, error } = await service.from("meta_daily_insights").select("external_entity_id,parent_external_id,metadata")
          .eq("agency_id", input.agencyId).eq("ad_account_id", account.id).eq("level", "ad")
          .gte("insight_date", data.previousDateFrom).lte("insight_date", data.dateTo)
          .order("insight_date").order("external_entity_id").range(offset, offset + 999);
        if (error) throw new MetaSetupError("Não foi possível resolver anúncios históricos.");
        for (const row of history ?? []) if (!ads.some(ad => ad.id === row.external_entity_id)) {
          const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
          ads.push({ id: row.external_entity_id, name: row.external_entity_id, adset_id: row.parent_external_id ?? undefined,
            campaign_id: typeof metadata.campaign_id === "string" ? metadata.campaign_id : undefined });
        }
        if (!history || history.length < 1000) break;
      }
      adIds = ads.filter(ad => keys.includes("ad:" + ad.id) || keys.includes("adset:" + ad.adset_id) || keys.includes("campaign:" + ad.campaign_id)).map(ad => ad.id);
      if (hasOverlappingMetaSelection(ads, keys)) throw new MetaSetupError("Selecione campanhas, conjuntos ou anúncios sem incluir também os seus descendentes.");
      for (const ad of ads) for (const key of ["ad:" + ad.id, "adset:" + ad.adset_id, "campaign:" + ad.campaign_id]) if (keys.includes(key)) resolvedKeys.add(key);
      if (!adIds.length) return null;
    }
    const [current, previous, previousCampaigns, ...detail] = await Promise.all([
      client.getPeriodInsights({ adAccountId: account.external_id, since: data.dateFrom, until: data.dateTo, adIds }),
      client.getPeriodInsights({ adAccountId: account.external_id, since: data.previousDateFrom, until: data.previousDateTo, adIds }),
      client.getPeriodInsights({ adAccountId: account.external_id, since: data.previousDateFrom, until: data.previousDateTo, adIds, level: "campaign" }),
      ...levels.map(level => client.getPeriodInsights({
        adAccountId: account.external_id, since: data.dateFrom, until: data.dateTo, adIds, level,
      })),
    ]);
    validateRows(current, account.external_id, data.dateFrom, data.dateTo, "account");
    validateRows(previous, account.external_id, data.previousDateFrom, data.previousDateTo, "account");
    validateRows(previousCampaigns, account.external_id, data.previousDateFrom, data.previousDateTo, "campaign");
    for (const [index, rows] of detail.entries()) validateRows(rows, account.external_id, data.dateFrom, data.dateTo, levels[index]);
    const previousChildren = await Promise.all((["adset", "ad"] as const).map(async level => {
      if (!keys.some(key => key.startsWith(level + ":"))) return [];
      const rows = await client.getPeriodInsights({ adAccountId: account.external_id, since: data.previousDateFrom, until: data.previousDateTo, adIds, level });
      validateRows(rows, account.external_id, data.previousDateFrom, data.previousDateTo, level);
      return rows;
    }));
    return { account, current, previous, previousCampaigns, detail, previousDetail: [previousCampaigns, ...previousChildren] };
  }));
  const relevant = periods.filter((row): row is NonNullable<typeof row> => !!row);
  if (keys.some(key => !resolvedKeys.has(key))) throw new MetaSetupError("A Meta não confirmou todos os anúncios desta seleção. Atualize os dados e tente novamente.");
  if (!relevant.length) throw new MetaSetupError("A Meta não confirmou os anúncios desta seleção.");
  const actionTypes = insightActionTypes(relevant.flatMap(period => [...period.current, ...period.previous, ...period.previousDetail.flat(), ...period.detail.flat()]));
  const accountValues: Record<string, AnalyticsValues> = {};
  const entityValues: Record<string, AnalyticsValues> = {};
  const entityCatalog: Array<Record<string, unknown>> = [];
  const accountPeriodValues = (period: typeof relevant[number], current: boolean) => {
    const detail = current ? period.detail : period.previousDetail;
    const resultRows = keys.length ? selectedPeriodInsightRows(levels.map((level, index) => ({ level, rows: detail[index] })), keys) : detail[0];
    return applyProviderResults(periodInsightValues((current ? period.current : period.previous)[0], { confirmedEmpty: true, actionTypes }),
      campaignResultTotals(resultRows));
  };
  for (const period of relevant) {
    accountValues[period.account.id] = accountPeriodValues(period, true);
    const account = data.accounts.find(item => item.id === period.account.id);
    if (!account) throw new MetaSetupError("Conta fora do catálogo autorizado.");
    for (const [index, rows] of period.detail.entries()) for (const row of rows) {
      const level = levels[index];
      const id = String(row[level + "_id"]);
      const key = level + ":" + id;
      const values = periodInsightValues(row, { actionTypes });
      entityValues[account.id + ":" + key] = values;
      entityCatalog.push({ key, id, level, name: String(row[level + "_name"] ?? id),
        parentId: level === "campaign" ? null : String(level === "adset" ? row.campaign_id : row.adset_id),
        campaignId: String(row.campaign_id), accountId: account.id, accountName: account.name, currency: account.currency, values });
    }
  }
  const summary = sumPeriodInsightValues(relevant.map(period => accountPeriodValues(period, true)), !!data.currency);
  const previousSummary = sumPeriodInsightValues(relevant.map(period => accountPeriodValues(period, false)), !!data.currency);
  const metrics: AnalyticsMetric[] = [];
  const metricKeys = new Set([...Object.keys(summary), ...Object.keys(previousSummary), ...Object.values(entityValues).flatMap(value => Object.keys(value))]);
  const currencyKeys = new Set(["spend", "social_spend", "cpc", "cpp", "cpc_link", "cpm", "cost_per_result", "attributed_revenue"]);
  const percentKeys = new Set(["ctr", "ctr_link", "unique_ctr", "unique_inline_link_click_ctr", "outbound_clicks_ctr", "unique_outbound_clicks_ctr"]);
  for (const key of metricKeys) {
    if (key.startsWith("result:")) continue;
    const unit = currencyKeys.has(key) || key.startsWith("cost:") || key.startsWith("value:") ? "currency"
      : percentKeys.has(key) ? "percent" : ["frequency", "roas"].includes(key) ? "ratio" : "integer";
    metrics.push({ key, label: metaMetricLabel(key, key), unit, precision: unit === "integer" ? 0 : 2,
      desirable: key.startsWith("cost:") || ["cpc", "cpp", "cpc_link", "cpm", "cost_per_result"].includes(key) ? "down"
        : ["spend", "social_spend", "frequency"].includes(key) ? "neutral" : "up" });
  }
  const collectedAt = new Date().toISOString();
  const { error } = await service.from("meta_dashboard_scopes").upsert({ agency_id: input.agencyId, client_id: input.clientId,
    scope_key: scopeKey, date_from: data.dateFrom, date_to: data.dateTo, collected_at: collectedAt,
    payload: { version: META_ANALYTICS_VERSION, summary, previousSummary, metrics, entityValues, entityCatalog, accountValues, actionTypes,
      source: { apiVersion, timeIncrement: "all_days", attribution: "provider_adset", dateFrom: data.dateFrom, dateTo: data.dateTo,
        previousDateFrom: data.previousDateFrom, previousDateTo: data.previousDateTo, accountIds: data.selectedAccountIds, entityKeys: keys },
      estimatedMetricKeys: relevant.length > 1 ? ["reach", "frequency", "unique_clicks", "unique_inline_link_clicks", "unique_outbound_clicks", "unique_ctr", "unique_inline_link_click_ctr", "unique_outbound_clicks_ctr"] : [] } as unknown as Json });
  if (error) throw new MetaSetupError("Não foi possível preservar os agregados da Meta.");
  return { confirmed: true as const, version: META_ANALYTICS_VERSION, collectedAt, actionTypes };
}

export type LiveCampaignIdentity = { accountId: string; id: string; name: string };

// Called only after the dashboard has authorized access to this client.
export async function getMetaEntityStatuses(input: { agencyId: string; clientId: string; accountIds: string[]; entities?: { accountId: string; key: string }[] }, thumbnails?: Record<string, string>, catalog?: LiveCampaignIdentity[]): Promise<Record<string, string>> {
  const statuses: Record<string, string> = {};
  if (!input.accountIds.length) return statuses;
  try {
    const { service, apiVersion } = operationalDependencies();
    const { integration, connection } = await getStoredConnection(service, input.agencyId, input.clientId);
    const { data: links, error: linkError } = await service.from("client_ad_accounts").select("ad_account_id")
      .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("active", true).in("ad_account_id", input.accountIds);
    if (linkError || links?.length !== input.accountIds.length) return statuses;
    const { data: accounts, error } = await service.from("meta_ad_accounts").select("id,external_id,timezone_name,account_status")
      .eq("agency_id", input.agencyId).eq("meta_connection_id", connection.id).in("id", input.accountIds).is("archived_at", null);
    if (error || !accounts) return statuses;
    const token = await loadAccessToken(service, input.agencyId, integration.id, connection.id);
    const client = new MetaClient({ accessToken: token, apiVersion });
    await Promise.allSettled(accounts.map(async account => {
      // Account edges establish ownership and paginate the entire live catalog.
      // Never reuse captured statuses, partial pages, or exact objects from another account.
      const [campaignsResult, adsetsResult, adsResult, accountResult] = await Promise.allSettled([
        client.listCampaigns(account.external_id), client.listAdSets(account.external_id), client.listAds(account.external_id),
        client.getAdAccount(account.external_id),
      ]);
      // Live account status first; the last synced status covers a failed read.
      const accountStatus = accountResult.status === "fulfilled" && accountResult.value.account_status !== undefined
        ? accountResult.value.account_status : account.account_status;
      const campaigns = campaignsResult.status === "fulfilled" ? campaignsResult.value : [];
      const adsets = adsetsResult.status === "fulfilled" ? adsetsResult.value : [];
      const ads = adsResult.status === "fulfilled" ? adsResult.value : [];
      catalog?.push(...campaigns.map(c => ({ accountId: account.id, id: c.id, name: c.name })));
      if (thumbnails) for (const ad of ads) {
        const thumbnail = ad.creative?.thumbnail_url;
        if (!thumbnail) continue;
        try {
          const url = new URL(thumbnail);
          if (url.protocol === "https:" && (url.hostname.endsWith(".fbcdn.net") || url.hostname.endsWith(".facebook.com"))) thumbnails[`${account.id}:ad:${ad.id}`] = url.href;
        } catch { /* Missing or invalid creative images do not block analytics. */ }
      }
      const live = liveDeliveryStatuses(campaigns, adsets, ads, Date.now(), accountStatus);
      for (const [key, status] of Object.entries(live)) statuses[`${account.id}:${key}`] = status;
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
    .select("id,external_user_id,metadata")
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
  selectedAccountIds?: string[];
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
  const accounts = selectedMetaAccounts(await client.listAdAccounts(input.selectedAccountIds ? undefined : identity.id), input.selectedAccountIds);
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
    metadata: { identity_name: identity.name ?? null, ...(input.selectedAccountIds ? { selected_account_ids: input.selectedAccountIds } : {}) },
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
    const metadata = connection.metadata as { selected_account_ids?: string[] } | null;
    const available = await client.listAdAccounts(metadata?.selected_account_ids ? undefined : connection.external_user_id ?? undefined);
    const selection = metadata?.selected_account_ids;
    const accounts = selection ? available.filter(account => selection.includes(account.id)) : available;
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
  // Insight queries can be materially heavier than metadata/status requests on large accounts.
  // Keep bounded retries, but give the provider enough time to return all pages before treating the slice as failed.
  const client = new MetaClient({ accessToken: token, apiVersion, timeoutMs: 25_000, retryDelayMs: 1_000 });

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
  let granularFailureCount = 0;
  let completedSliceCount = 0;
  let reusedSliceCount = 0;
  const failures: Array<{ accountId: string; since: string; until: string; scope: "daily" | "period" | "account"; code: string }> = [];
  const slices = splitCollectionRange(input.since, input.until);
  const historicalCutoff = new Date(Date.now() - META_ATTRIBUTION_REFRESH_DAYS * 86_400_000).toISOString().slice(0, 10);

  async function recordFailure(accountId: string, slice: { since: string; until: string }, error: unknown, scope: "daily" | "account") {
    const code = error instanceof MetaApiError ? String(error.code ?? error.httpStatus) : "persistence_or_validation";
    failures.push({ accountId, ...slice, scope, code });
    // A failed request never replaces the previously collected rows.
    const { data: existing } = await service.from("meta_collection_runs").select("status,collected_at")
      .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("ad_account_id", accountId)
      .eq("date_from", slice.since).eq("date_to", slice.until).maybeSingle();
    // A transient refresh failure must never downgrade a previously complete slice.
    // Keep the last complete snapshot valid until another complete collection replaces it.
    if (existing?.status === "complete") return;
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
        .eq("status", "complete").lte("date_from", input.until).gte("date_to", input.since);
      if (runError) throw new MetaSetupError("Não foi possível consultar o histórico das coletas.");
      const completeRuns = (previousRuns ?? []).map(run => ({ ...run, levels: run.levels ?? [] }));
      const missingCoreSlice = slices.some(slice => !coveringCollectionRun(completeRuns, slice));
      let allDailyComplete = true;
      for (const slice of slices) {
        const previous = coveringCollectionRun(completeRuns, slice);
        // During recovery, preserve every slice already confirmed by Meta and request only gaps.
        // Once coverage is complete, automatic refreshes revisit only the recent attribution window.
        const canReuse = !input.forceRefresh && previous && (missingCoreSlice || slice.until < historicalCutoff);
        if (canReuse && previous) {
          if (previous.date_from === slice.since && previous.date_to === slice.until) {
            insightCount += previous.insight_count;
            actionCount += previous.action_count;
          }
          completedSliceCount += 1;
          reusedSliceCount += 1;
          continue;
        }
        try {
          // Core dashboard integrity depends only on account + campaign data.
          // Persist those first so a heavier adset/ad request can never discard a complete period.
          const [accountInsights, campaignInsights] = await Promise.all([
            client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "account" }),
            client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "campaign" }),
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
          });
          const { data: persisted, error: persistError } = await service.rpc("persist_meta_insight_slice", {
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
          completedSliceCount += 1;

          // When core coverage has gaps, finish account/campaign recovery first. Heavy adset/ad
          // queries must never consume the execution window before the requested period is complete.
          if (!missingCoreSlice) {
            try {
              const [adsetInsights, adInsights] = await Promise.all([
                client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "adset" }),
                client.getDailyInsights({ adAccountId: account.external_id, ...slice, level: "ad" }),
              ]);
              const detailed = normalizeInsightSlice({
                agencyId: input.agencyId,
                accountId: account.id,
                externalAccountId: account.external_id,
                ...slice,
                timezoneName: liveAccount.timezone_name,
                businessId: liveAccount.business!.id!,
                apiVersion,
                collectedAt: new Date().toISOString(),
                accountInsights,
                campaignInsights,
                adsetInsights,
                adInsights,
              });
              const { error: detailedPersistError } = await service.rpc("persist_meta_detailed_slice", {
                p_agency_id: input.agencyId,
                p_client_id: input.clientId,
                p_ad_account_id: account.id,
                p_date_from: slice.since,
                p_date_to: slice.until,
                p_insights: detailed.insights as Json,
                p_actions: detailed.actions as Json,
              }).single();
              if (detailedPersistError) throw new MetaSetupError("Não foi possível persistir o detalhamento de conjuntos e anúncios.");
              granularInsightCount += detailed.insights.filter(row => row.level === "adset" || row.level === "ad").length;
              granularActionCount += detailed.actions.filter(row => row.level === "adset" || row.level === "ad").length;
            } catch {
              granularFailureCount += 1;
            }
          }
        } catch (error) {
          await recordFailure(account.id, slice, error, "daily");
          // A failed refresh does not invalidate an older complete snapshot that still covers this slice.
          // Missing slices stay incomplete, but the collector keeps going so one failure cannot block the rest.
          if (!previous) allDailyComplete = false;
          continue;
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
        granular_failure_count: granularFailureCount,
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
      granularFailureCount,
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
