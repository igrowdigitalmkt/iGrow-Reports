import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CollectionIdentity } from "./data-contract";
import type { ProviderAdapter } from "./worker-contract";
import { transitionAfterCollection } from "./worker-contract";
import { authorizeCollectionJob, claimCollectionJob, finishCollectionJob, persistCollectionResult, recordProviderHealth } from "./repository";
import { runProviderJob } from "./worker-runner";

export async function runOneIntegrationJob(service: SupabaseClient<Database>, adapters: Record<string, ProviderAdapter>,claimProvider?: "meta"): Promise<boolean> {
  const job = await claimCollectionJob(service,new Date(),claimProvider);
  if (!job) return false;
  const adapter = adapters[job.provider];
  if (!adapter || adapter.provider !== job.provider) {
    await finishCollectionJob(service, job.job_id, job.attempt_count, { status: "failed", errorCode: "provider_not_registered", errorMessage: `Provedor não registrado: ${job.provider}` });
    return true;
  }
  const integrationId = await authorizeCollectionJob(service, job.job_id, job.attempt_count);
  if (!integrationId) {
    await finishCollectionJob(service, job.job_id, job.attempt_count, { status: "failed", errorCode: "collection_scope_invalid", errorMessage: "Cliente, conexão ou conta sem autorização para coleta." });
    return true;
  }
  const identity: CollectionIdentity = { clientId: job.client_id, connectionId: job.connection_id, provider: adapter.provider, externalAccountId: job.external_account_id, dateFrom: job.date_from, dateTo: job.date_to, level: job.entity_level as CollectionIdentity["level"], apiVersion: job.api_version, contractVersion: job.contract_version };
  await runProviderJob(adapter, identity, {
    persistResult: async result => { await persistCollectionResult(service, job.job_id, job.attempt_count, result, transitionAfterCollection(result).status === "confirmed" ? "confirmed" : "partial"); },
    markTransition: async transition => { await finishCollectionJob(service, job.job_id, job.attempt_count, transition); },
    recordHealth: async event => { await recordProviderHealth(service, integrationId, job.provider, event); },
  }, job.retry_attempt_count ?? job.attempt_count);
  return true;
}
