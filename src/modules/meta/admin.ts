import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getEncryptionConfig, getMetaApiConfig, getPrivilegedSupabaseConfig } from "@/lib/env";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { Database } from "@/types/database";
import type { MetaAdminSnapshot } from "./types";

export async function getMetaAdminSnapshot(
  supabase: SupabaseClient<Database>,
  agencyId: string,
): Promise<MetaAdminSnapshot> {
  const [accountsResult, linksResult, mappingsResult, integrationResult, connectionResult] = await Promise.all([
    supabase
      .from("meta_ad_accounts")
      .select("id,meta_connection_id,external_id,name,currency,timezone_name,archived_at,last_synced_at")
      .eq("agency_id", agencyId)
      .order("name")
      .order("id"),
    supabase
      .from("client_ad_accounts")
      .select("client_id,ad_account_id,active")
      .eq("agency_id", agencyId),
    supabase
      .from("client_metric_mappings")
      .select("client_id,primary_metric_key,primary_action_type,revenue_action_type,mapping_version")
      .eq("agency_id", agencyId),
    supabase
      .from("integrations")
      .select("connection_status,health_status,last_checked_at,last_success_at,last_error_at")
      .eq("agency_id", agencyId)
      .eq("provider", "meta")
      .maybeSingle(),
    supabase
      .from("meta_connections")
      .select("id,client_id,label,scopes,connected_at,last_accounts_sync_at")
      .eq("agency_id", agencyId)
      .not("client_id", "is", null)
      .order("created_at"),
  ]);

  const privileged = getPrivilegedSupabaseConfig();
  const encryption = getEncryptionConfig();
  const metaConfig = getMetaApiConfig();
  const errors = [
    accountsResult.error,
    linksResult.error,
    mappingsResult.error,
    integrationResult.error,
    connectionResult.error,
  ].filter(Boolean);
  const databaseReady = errors.length === 0;

  if (!databaseReady && !errors.every((error) => isMissingSchemaError(error))) {
    throw new Error("Não foi possível consultar a configuração Meta deste espaço de trabalho.");
  }

  if (!databaseReady) {
    return {
      accounts: [],
      links: [],
      mappings: [],
      integration: null,
      connections: [],
      serverReadiness: {
        databaseReady: false,
        serviceRoleConfigured: !!privileged,
        encryptionConfigured: !!encryption,
        apiVersion: metaConfig?.apiVersion ?? null,
        ready: false,
      },
    };
  }

  return {
    accounts: (accountsResult.data ?? []).map((row) => ({
      id: row.id,
      connectionId: row.meta_connection_id,
      externalId: row.external_id,
      name: row.name,
      currency: row.currency,
      timezoneName: row.timezone_name,
      archivedAt: row.archived_at,
      lastSyncedAt: row.last_synced_at,
    })),
    links: (linksResult.data ?? []).map((row) => ({
      clientId: row.client_id,
      adAccountId: row.ad_account_id,
      active: row.active,
    })),
    mappings: (mappingsResult.data ?? []).map((row) => ({
      clientId: row.client_id,
      primaryMetricKey: row.primary_metric_key as "leads" | "conversations" | "purchases",
      primaryActionType: row.primary_action_type,
      revenueActionType: row.revenue_action_type,
      mappingVersion: row.mapping_version,
    })),
    integration: integrationResult.data
      ? {
          connectionStatus: integrationResult.data.connection_status,
          healthStatus: integrationResult.data.health_status,
          lastCheckedAt: integrationResult.data.last_checked_at,
          lastSuccessAt: integrationResult.data.last_success_at,
          lastErrorAt: integrationResult.data.last_error_at,
        }
      : null,
    connections: (connectionResult.data ?? [])
      .filter((row) => row.client_id)
      .map((row) => ({
        id: row.id,
        clientId: row.client_id as string,
        label: row.label,
        scopes: row.scopes,
        connectedAt: row.connected_at,
        lastAccountsSyncAt: row.last_accounts_sync_at,
      })),
    serverReadiness: {
      databaseReady: true,
      serviceRoleConfigured: !!privileged,
      encryptionConfigured: !!encryption,
      apiVersion: metaConfig?.apiVersion ?? null,
      ready: !!privileged && !!encryption && !!metaConfig,
    },
  };
}
