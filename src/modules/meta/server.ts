import "server-only";

import Decimal from "decimal.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptServerSecret,
  encryptServerSecret,
  type EncryptedSecret,
} from "@/lib/crypto";
import { getMetaApiConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import {
  MetaApiError,
  MetaClient,
  type MetaAdAccount,
  type MetaInsight,
} from "./client";

const TOKEN_KIND = "meta_access_token";

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

function secretAad(agencyId: string, integrationId: string) {
  return `igrow-reports:${agencyId}:${integrationId}:${TOKEN_KIND}`;
}

async function storeAccessToken(
  service: SupabaseClient<Database>,
  agencyId: string,
  integrationId: string,
  accessToken: string,
) {
  const encrypted = encryptServerSecret(
    accessToken,
    secretAad(agencyId, integrationId),
  );
  const { error } = await service
    .schema("private")
    .from("integration_secrets")
    .upsert({
      agency_id: agencyId,
      integration_id: integrationId,
      secret_kind: TOKEN_KIND,
      key_id: encrypted.keyId,
      nonce_b64: encrypted.nonceB64,
      ciphertext_b64: encrypted.ciphertextB64,
      auth_tag_b64: encrypted.authTagB64,
      updated_at: new Date().toISOString(),
    }, { onConflict: "integration_id,secret_kind" });
  if (error) throw new MetaSetupError("Não foi possível armazenar a credencial Meta com segurança.");
}

async function loadAccessToken(
  service: SupabaseClient<Database>,
  agencyId: string,
  integrationId: string,
) {
  const { data, error } = await service
    .schema("private")
    .from("integration_secrets")
    .select("key_id,nonce_b64,ciphertext_b64,auth_tag_b64")
    .eq("agency_id", agencyId)
    .eq("integration_id", integrationId)
    .eq("secret_kind", TOKEN_KIND)
    .single();

  if (error || !data) {
    throw new MetaSetupError("A credencial Meta desta agência não está disponível.");
  }

  const envelope: EncryptedSecret = {
    keyId: data.key_id,
    nonceB64: data.nonce_b64,
    ciphertextB64: data.ciphertext_b64,
    authTagB64: data.auth_tag_b64,
  };
  return decryptServerSecret(envelope, secretAad(agencyId, integrationId));
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
  }

  if (accounts.length) {
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

async function getStoredConnection(
  service: SupabaseClient<Database>,
  agencyId: string,
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

  const { data: connection, error: connectionError } = await service
    .from("meta_connections")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("integration_id", integration.id)
    .single();
  if (connectionError || !connection) {
    throw new MetaSetupError("A conexão Meta desta agência está incompleta.");
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

export async function connectMetaForAgency(input: {
  agencyId: string;
  actorId: string;
  accessToken: string;
}) {
  const { service, apiVersion } = operationalDependencies();
  const client = new MetaClient({
    accessToken: input.accessToken,
    apiVersion,
  });

  const [identity, permissions, accounts] = await Promise.all([
    client.validateConnection(),
    client.listPermissions(),
    client.listAdAccounts(),
  ]);
  const grantedScopes = permissions
    .filter((permission) => permission.status === "granted")
    .map((permission) => permission.permission);

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

  const { data: connection, error: connectionError } = await service
    .from("meta_connections")
    .upsert({
      agency_id: input.agencyId,
      integration_id: integration.id,
      external_user_id: identity.id,
      scopes: grantedScopes,
      metadata: { identity_name: identity.name ?? null },
      connected_at: now,
      last_accounts_sync_at: now,
      updated_at: now,
    }, { onConflict: "agency_id,integration_id" })
    .select("id")
    .single();
  if (connectionError || !connection) {
    throw new MetaSetupError("Não foi possível registrar a conexão Meta.");
  }

  await storeAccessToken(
    service,
    input.agencyId,
    integration.id,
    input.accessToken,
  );
  const synced = await syncAccounts(
    service,
    input.agencyId,
    connection.id,
    accounts,
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

export async function syncMetaAccountsForAgency(input: {
  agencyId: string;
  actorId: string;
}) {
  const { service, apiVersion } = operationalDependencies();
  const { integration, connection } = await getStoredConnection(service, input.agencyId);
  const token = await loadAccessToken(service, input.agencyId, integration.id);
  const client = new MetaClient({ accessToken: token, apiVersion });

  try {
    const accounts = await client.listAdAccounts();
    const synced = await syncAccounts(
      service,
      input.agencyId,
      connection.id,
      accounts,
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

function decimalOrZero(value: string | undefined) {
  try {
    return new Decimal(value ?? "0");
  } catch {
    return new Decimal(0);
  }
}

function actionRows(insight: MetaInsight) {
  const totals = new Map<string, {
    actionValue: Decimal;
    valueAmount: Decimal | null;
  }>();

  for (const action of insight.actions ?? []) {
    const existing = totals.get(action.action_type) ?? {
      actionValue: new Decimal(0),
      valueAmount: null,
    };
    existing.actionValue = existing.actionValue.add(decimalOrZero(action.value));
    totals.set(action.action_type, existing);
  }

  for (const value of insight.action_values ?? []) {
    const existing = totals.get(value.action_type) ?? {
      actionValue: new Decimal(0),
      valueAmount: null,
    };
    const next = decimalOrZero(value.value);
    existing.valueAmount = (existing.valueAmount ?? new Decimal(0)).add(next);
    totals.set(value.action_type, existing);
  }

  return [...totals.entries()].map(([actionType, values]) => ({
    actionType,
    actionValue: values.actionValue.toNumber(),
    valueAmount: values.valueAmount?.toNumber() ?? null,
  }));
}

export async function collectMetaClientInsights(input: {
  agencyId: string;
  clientId: string;
  actorId: string;
  since: string;
  until: string;
}) {
  const { service, apiVersion } = operationalDependencies();
  const { integration } = await getStoredConnection(service, input.agencyId);
  const token = await loadAccessToken(service, input.agencyId, integration.id);
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
    .in("id", accountIds)
    .is("archived_at", null);
  if (accountsError || !accounts?.length) {
    throw new MetaSetupError("As contas Meta associadas não estão disponíveis.");
  }

  if (new Set(accounts.map((account) => account.currency)).size !== 1) {
    throw new MetaSetupError("A coleta consolidada foi bloqueada porque as contas usam moedas diferentes.");
  }
  if (new Set(accounts.map((account) => account.timezone_name)).size !== 1) {
    throw new MetaSetupError("A coleta consolidada foi bloqueada porque as contas usam fusos diferentes.");
  }

  let insightCount = 0;
  let actionCount = 0;

  try {
    for (const account of accounts) {
      const insights = await client.getDailyInsights({
        adAccountId: account.external_id,
        since: input.since,
        until: input.until,
        level: "account",
      });

      for (const insight of insights) {
        const date = insight.date_start;
        if (!date) continue;

        const insightRow = {
          agency_id: input.agencyId,
          ad_account_id: account.id,
          insight_date: date,
          level: "account" as const,
          external_entity_id: account.external_id,
          entity_name: insight.account_name ?? null,
          objective: null,
          captured_status: null,
          spend: Number(decimalOrZero(insight.spend).toFixed(8)),
          impressions: Number(decimalOrZero(insight.impressions).toFixed(0)),
          reach: insight.reach === undefined
            ? null
            : Number(decimalOrZero(insight.reach).toFixed(0)),
          link_clicks: insight.inline_link_clicks === undefined
            ? null
            : Number(decimalOrZero(insight.inline_link_clicks).toFixed(0)),
          api_version: apiVersion,
          attribution_setting: null,
          collected_at: new Date().toISOString(),
          metadata: {},
        };
        const { error: insightError } = await service
          .from("meta_daily_insights")
          .upsert(insightRow, {
            onConflict: "agency_id,ad_account_id,insight_date,level,external_entity_id",
          });
        if (insightError) {
          throw new MetaSetupError("Não foi possível persistir um Insight da Meta.");
        }
        insightCount += 1;

        const { error: deleteError } = await service
          .from("meta_daily_actions")
          .delete()
          .eq("agency_id", input.agencyId)
          .eq("ad_account_id", account.id)
          .eq("insight_date", date)
          .eq("level", "account")
          .eq("external_entity_id", account.external_id);
        if (deleteError) {
          throw new MetaSetupError("Não foi possível reconciliar as ações da coleta Meta.");
        }

        const normalizedActions = actionRows(insight);
        if (normalizedActions.length) {
          const { error: actionsError } = await service
            .from("meta_daily_actions")
            .insert(normalizedActions.map((action) => ({
              agency_id: input.agencyId,
              ad_account_id: account.id,
              insight_date: date,
              level: "account" as const,
              external_entity_id: account.external_id,
              action_type: action.actionType,
              action_value: action.actionValue,
              value_amount: action.valueAmount,
              collected_at: new Date().toISOString(),
            })));
          if (actionsError) {
            throw new MetaSetupError("Não foi possível persistir as ações da coleta Meta.");
          }
          actionCount += normalizedActions.length;
        }
      }

      await service.from("meta_ad_accounts")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("agency_id", input.agencyId)
        .eq("id", account.id);
    }

    const now = new Date().toISOString();
    await service.from("integrations")
      .update({
        health_status: "healthy",
        last_checked_at: now,
        last_success_at: now,
        last_error_at: null,
        last_error_code: null,
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
        api_version: apiVersion,
      },
    });

    return {
      accountCount: accounts.length,
      insightCount,
      actionCount,
      apiVersion,
    };
  } catch (error) {
    await markIntegrationFailure(service, input.agencyId, integration.id, error);
    throw error;
  }
}
