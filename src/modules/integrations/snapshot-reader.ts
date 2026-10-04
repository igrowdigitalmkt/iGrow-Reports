import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CollectionIdentity } from "./data-contract";
import { projectConfirmedSnapshot } from "./snapshot-projection";

// Pass the authenticated SSR client so the RPC evaluates the user's memberships.
export async function readConfirmedCollectionSnapshot(client: SupabaseClient<Database>, identity: CollectionIdentity, now = Date.now()) {
  const { data,error } = await client.rpc("get_confirmed_collection_snapshot", {
    p_client_id: identity.clientId,p_connection_id: identity.connectionId,p_provider: identity.provider,
    p_external_account_id: identity.externalAccountId,p_date_from: identity.dateFrom,p_date_to: identity.dateTo,
    p_entity_level: identity.level,p_api_version: identity.apiVersion,p_contract_version: identity.contractVersion,
  });
  if (error) throw new Error("Não foi possível consultar o snapshot confirmado.");
  return projectConfirmedSnapshot(data,identity,now);
}
