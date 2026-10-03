import { aggregateResults } from "@/modules/client-portal/analytics-results";
import { campaignResultTotals, providerResultValues } from "./result-values";
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
} from "./client";
import { coveringCollectionRun, normalizeInsightSlice, periodInsightMetrics, periodScalarValue, splitCollectionRange, validateCollectionRange } from "./collection";

const TOKEN_KIND = "meta_access_token";

// The caller first obtains data through the authenticated, client-scoped RPC.
export async function refreshMetaDashboardScope(input: { agencyId: string; clientId: string; data: AnalyticsDashboardData; entityKeys?: string[] }) {
  const { data } = input;
  const keys = input.entityKeys ?? [];
  if (!data.selectedAccountIds.length) return;
  const scopeKey = createHash("md5").update([...data.selectedAccountIds].sort().join(",") + "|" + [...keys].sort().join(",")).digest("hex");
  const { service, apiVersion } = operationalDependencies();
  const { data: cached } = await service.from("meta_dashboard_scopes").select("collected_at,payload")
    .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("scope_key", scopeKey)
    .eq("date_from", data.dateFrom).eq("date_to", data.dateTo).maybeSingle();
  if (cached && Date.now() - Date.parse(cached.collected_at) < 3_600_000
    && cached.payload && typeof cached.payload === "object" && !Array.isArray(cached.payload) && cached.payload.version === 6
    && Date.parse(data.coverage.latestCollectedAt ?? "1970-01-01") <= Date.parse(cached.collected_at)) return;
  const { integration, connection } = await getStoredConnection(service, input.agencyId, input.clientId);
  const { data: links } = await service.from("client_ad_accounts").select("ad_account_id")
    .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("active", true).in("ad_account_id", data.selectedAccountIds);
  if (links?.length !== data.selectedAccountIds.length) throw new MetaSetupError("Contas fora do escopo autorizado.");
  const { data: accounts } = await service.from("meta_ad_accounts").select("id,external_id")
    .eq("agency_id", input.agencyId).eq("meta_connection_id", connection.id).in("id", data.selectedAccountIds).is("archived_at", null);
  if (accounts?.length !== data.selectedAccountIds.length) throw new MetaSetupError("Contas indisponíveis.");
  const token = await loadAccessToken(service, input.agencyId, integration.id, connection.id);
  const client = new MetaClient({ accessToken: token, apiVersion });
  const entityValues: Record<string, Record<string, number>> = {};
  const resolvedKeys = new Set<string>();
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
      adIds = ads.filter(ad => keys.includes(`ad:${ad.id}`) || keys.includes(`adset:${ad.adset_id}`) || keys.includes(`campaign:${ad.campaign_id}`)).map(ad => ad.id);
      for (const ad of ads) for (const key of [`ad:${ad.id}`, `adset:${ad.adset_id}`, `campaign:${ad.campaign_id}`]) if (keys.includes(key)) resolvedKeys.add(key);
      if (!adIds.length) return null;
    }
    const [current, previous, previousCampaigns, ...detail] = await Promise.all([
      client.getPeriodInsights({ adAccountId: account.external_id, since: data.dateFrom, until: data.dateTo, adIds }),
      client.getPeriodInsights({ adAccountId: account.external_id, since: data.previousDateFrom, until: data.previousDateTo, adIds }),
      client.getPeriodInsights({ adAccountId: account.external_id, since: data.previousDateFrom, until: data.previousDateTo, adIds, level: "campaign" }),
      ...(["campaign", "adset", "ad"] as const).map(level => client.getPeriodInsights({
        adAccountId: account.external_id, since: data.dateFrom, until: data.dateTo, adIds, level,
      })),
    ]);
    for (const [index, rows] of detail.entries()) for (const row of rows) {
      const level = (["campaign", "adset", "ad"] as const)[index];
      const id = row[`${level}_id`];
      if (!id) continue;
      const values: Record<string, number> = {};
      for (const key of ["reach", "frequency", "unique_clicks"]) if (row[key] != null) values[key] = Number(row[key]);
      const result = providerResultValues(row);
      if (result) Object.assign(values, aggregateResults({ ...result, spend: Number(row.spend ?? 0) }, true));
      entityValues[`${account.id}:${level}:${id}`] = values;
    }
    if (current.length > 1 || previous.length > 1) throw new MetaSetupError("A Meta não retornou um agregado único por conta.");
    if ([...current, ...previous].some(row => row.account_id && `act_${row.account_id}` !== account.external_id)) throw new MetaSetupError("Agregado fora da conta autorizada.");
    return {
      current: current[0] ?? {},
      previous: previous[0] ?? {},
      currentResults: campaignResultTotals(detail[0]),
      previousResults: campaignResultTotals(previousCampaigns),
    };
  }));
  const relevant = periods.filter((row): row is NonNullable<typeof row> => !!row);
  if (keys.some(key => !resolvedKeys.has(key))) throw new MetaSetupError("A Meta não confirmou todos os anúncios desta seleção. Atualize os dados e tente novamente.");
  if (!relevant.length) return;
  const metrics: AnalyticsMetric[] = [];
  const add = (key: string, label: string, unit: AnalyticsMetric["unit"] = "integer") => {
    if (!metrics.some(metric => metric.key === key)) metrics.push({ key, label: metaMetricLabel(key, label), unit, precision: unit === "integer" ? 0 : 2, desirable: "neutral" });
  };
  const calculate = (period: "current" | "previous"): AnalyticsValues => {
    const rows = relevant.map(row => row[period]);
    const values: AnalyticsValues = {};
    const scalar = (key: string) => {
      const amounts = rows.map(row => periodScalarValue(row, key));
      return amounts.every(amount => amount !== null) ? amounts.reduce<number>((sum, amount) => sum + amount!, 0) : null;
    };
    const spend = data.currency ? scalar("spend") : null;
    const impressions = scalar("impressions"), clicks = scalar("clicks");
    if (clicks !== null) values.clicks = clicks;
    add("clicks", "Cliques (todos)");
    if (rows.length === 1) for (const key of ["reach", "frequency", "unique_clicks", "unique_inline_link_clicks", "unique_inline_link_click_ctr", "unique_ctr"]) {
      values[key] = periodScalarValue(rows[0], key);
      add(key, key, key.includes("ctr") ? "percent" : key === "frequency" ? "ratio" : "integer");
    }
    if (rows.length > 1) {
      for (const key of ["reach", "unique_clicks", "unique_inline_link_clicks"]) {
        values[key] = scalar(key); add(key, key);
      }
      values.frequency = values.reach && impressions !== null ? impressions / values.reach : null;
      values.unique_ctr = impressions && values.unique_clicks != null ? values.unique_clicks / impressions * 100 : null;
      values.unique_inline_link_click_ctr = impressions && values.unique_inline_link_clicks != null ? values.unique_inline_link_clicks / impressions * 100 : null;
      add("frequency", "Frequência", "ratio"); add("unique_ctr", "CTR único (todos)", "percent"); add("unique_inline_link_click_ctr", "CTR único (taxa de cliques no link)", "percent");
    }
    for (const key of ["inline_post_engagement", "social_spend", "instagram_profile_visits"]) {
      const amount = key === "social_spend" && !data.currency ? null : scalar(key);
      if (amount !== null) values[key] = amount;
      add(key, key, key === "social_spend" ? "currency" : "integer");
    }
    for (const [field, key] of [["outbound_clicks", "outbound_clicks"], ["unique_outbound_clicks", "unique_outbound_clicks"],
      ["video_play_actions", "video_plays"], ["video_p25_watched_actions", "video_p25"], ["video_p50_watched_actions", "video_p50"],
      ["video_p75_watched_actions", "video_p75"], ["video_p95_watched_actions", "video_p95"], ["video_p100_watched_actions", "video_p100"]]) {
      const lists = rows.map(row => Array.isArray(row[field]) ? row[field] as Array<{ value: string }>
        : Number(row.impressions ?? 0) === 0 && Number(row.spend ?? 0) === 0 ? [] : null);
      if (lists.every(list => list !== null)) values[key] = lists.reduce((sum, list) => sum + list!.reduce((total, action) => total + Number(action.value), 0), 0);
      add(key, key);
    }
    if (values.outbound_clicks != null && impressions) { values.outbound_clicks_ctr = values.outbound_clicks / impressions * 100; add("outbound_clicks_ctr", "CTR de saída", "percent"); }
    for (const [key, amount] of Object.entries({ ctr: impressions && clicks !== null ? clicks / impressions * 100 : null,
      cpc: clicks && spend !== null ? spend / clicks : null, cpp: values.reach && spend !== null ? spend / values.reach * 1000 : null })) {
      values[key] = amount; add(key, key, key === "ctr" ? "percent" : "currency");
    }
    const actionTotals = new Map<string, number>(), valueTotals = new Map<string, number>();
    for (const row of rows) for (const field of ["actions", "action_values"] as const) {
      const list = row[field];
      if (!Array.isArray(list)) continue;
      for (const action of list) {
        const totals = field === "actions" ? actionTotals : valueTotals;
        totals.set(action.action_type, (totals.get(action.action_type) ?? 0) + Number(action.value));
      }
    }
    for (const [action, count] of actionTotals) {
      const key = `action:${action}`;
      const label = metaMetricLabel(key, action.replaceAll("_", " "));
      values[key] = count; values[`cost:${key}`] = count && spend !== null ? spend / count : null;
      add(key, label); add(`cost:${key}`, label, "currency");
      if (valueTotals.has(action)) { values[`value:${key}`] = data.currency ? valueTotals.get(action)! : null; add(`value:${key}`, label, "currency"); }
    }
    if (values.inline_post_engagement == null && actionTotals.has("post_engagement")) values.inline_post_engagement = actionTotals.get("post_engagement")!;
    const nativeResults = relevant.map(account => account[period === "current" ? "currentResults" : "previousResults"]);
    if (nativeResults.every((result): result is AnalyticsValues => result !== null)) {
      values["result:provider_known"] = 1;
      for (const result of nativeResults) for (const [key, amount] of Object.entries(result)) {
        if (key.startsWith("result:provider:")) values[key] = (values[key] ?? 0) + (amount ?? 0);
      }
    }
    return aggregateResults({ ...values, spend }, true);
  };
  const summary = calculate("current"), previousSummary = calculate("previous");
  const { error } = await service.from("meta_dashboard_scopes").upsert({ agency_id: input.agencyId, client_id: input.clientId,
    scope_key: scopeKey, date_from: data.dateFrom, date_to: data.dateTo, collected_at: new Date().toISOString(),
    payload: { version: 6, summary, previousSummary, metrics, entityValues,
      estimatedMetricKeys: relevant.length > 1 ? ["reach", "frequency", "unique_clicks", "unique_inline_link_clicks", "unique_outbound_clicks", "unique_ctr", "unique_inline_link_click_ctr"] : [] } as unknown as Json });
  if (error) throw new MetaSetupError("Não foi possível preservar os agregados da Meta.");
}

type MetaEntityStatusEntity = { accountId: string; key: string };
type MetaStatusObject = { id: string; status?: string; effective_status?: string; creative?: { thumbnail_url?: string } };
type RequestedEntityIds = Record<"campaign" | "adset" | "ad", string[]>;

function requestedEntityIds(entities?: MetaEntityStatusEntity[]) {
  const byAccount = new Map<string, RequestedEntityIds>();
  for (const entity of entities ?? []) {
    const match = /^(campaign|adset|ad):(\d+)$/.exec(entity.key);
    if (!match) continue;
    const current = byAccount.get(entity.accountId) ?? { campaign: [], adset: [], ad: [] };
    current[match[1] as keyof RequestedEntityIds].push(match[2]);
    byAccount.set(entity.accountId, current);
  }
  return byAccount;
}

async function getExactStatusObjects(client: MetaClient, ids: string[], fields: string) {
  const results: MetaStatusObject[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    results.push(...await client.getObjects<MetaStatusObject>(ids.slice(index, index + 50), fields));
  }
  return results;
}

// Called only after the dashboard has authorized access to this client.
export async function getMetaEntityStatuses(input: { agencyId: string; clientId: string; accountIds: string[]; entities?: MetaEntityStatusEntity[] }, thumbnails?: Record<string, string>): Promise<Record<string, string>> {
  const statuses: Record<string, string> = {};
  if (!input.accountIds.length) return statuses;
  try {
    const { service, apiVersion } = operationalDependencies();
    const { integration, connection } = await getStoredConnection(service, input.agencyId, input.clientId);
    const { data: links, error: linkError } = await service.from("client_ad_accounts").select("ad_account_id")
      .eq("agency_id", input.agencyId).eq("client_id", input.clientId).eq("active", true).in("ad_account_id", input.accountIds);
    if (linkError || links?.length !== input.accountIds.length) return statuses;
    const { data: accounts, error } = await service.from("meta_ad_accounts").select("id,external_id,timezone_name")
      .eq("agency_id", input.agencyId).eq("meta_connection_id", connection.id).in("id", input.accountIds).is("archived_at", null);
    if (error || !accounts) return statuses;
    const requested = requestedEntityIds(input.entities);
    const token = await loadAccessToken(service, input.agencyId, integration.id, connection.id);
    const client = new MetaClient({ accessToken: token, apiVersion });
    await Promise.allSettled(accounts.map(async account => {
      const exact = requested.get(account.id);
      const [campaignsResult, adsetsResult, adsResult] = await Promise.allSettled(exact ? [
        getExactStatusObjects(client, exact.campaign, "id,name,objective,status,effective_status"),
        getExactStatusObjects(client, exact.adset, "id,name,campaign_id,status,effective_status"),
        getExactStatusObjects(client, exact.ad, "id,name,adset_id,campaign_id,status,effective_status,creative{id,thumbnail_url}"),
      ] : [client.listCampaigns(account.external_id), client.listAdSets(account.external_id), client.listAds(account.external_id)]);
      let campaigns = campaignsResult.status === "fulfilled" ? campaignsResult.value : [];
      let adsets = adsetsResult.status === "fulfilled" ? adsetsResult.value : [];
      let ads = adsResult.status === "fulfilled" ? adsResult.value : [];
      if (exact) {
        const missingCampaigns = new Set(exact.campaign.filter(id => !campaigns.some(entity => entity.id === id)));
        if (missingCampaigns.size) campaigns = [...campaigns, ...(await client.listCampaigns(account.external_id)).filter(entity => missingCampaigns.has(entity.id))];
        const missingAdsets = new Set(exact.adset.filter(id => !adsets.some(entity => entity.id === id)));
        if (missingAdsets.size) adsets = [...adsets, ...(await client.listAdSets(account.external_id)).filter(entity => missingAdsets.has(entity.id))];
        const missingAds = new Set(exact.ad.filter(id => !ads.some(entity => entity.id === id)));
        if (missingAds.size) ads = [...ads, ...(await client.listAds(account.external_id)).filter(entity => missingAds.has(entity.id))];
      }
      if (thumbnails) for (const ad of ads) {
        const thumbnail = ad.creative?.thumbnail_url;
        if (!thumbnail) continue;
        try {
          const url = new URL(thumbnail);
          if (url.protocol === "https:" && (url.hostname.endsWith(".fbcdn.net") || url.hostname.endsWith(".facebook.com"))) thumbnails[`${account.id}:ad:${ad.id}`] = url.href;
        } catch { /* Missing or invalid creative images do not block analytics. */ }
      }
      const results = [campaigns, adsets, ads];
      results.forEach((result, index) => {
        const level = ["campaign", "adset", "ad"][index];
        for (const entity of result) {
          const status = entity.status || entity.effective_status;
          if (status) statuses[`${account.id}:${level}:${entity.id}`] = status;
        }
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
  const historicalCutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

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
