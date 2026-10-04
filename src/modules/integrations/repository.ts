import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { collectionIdempotencyKey, type CollectionIdentity } from "./data-contract";
import type { ProviderCollectionResult } from "./worker-contract";

export async function enqueueCollectionJob(service: SupabaseClient<Database>, identity: CollectionIdentity, clientId: string, priority = 100) {
  const idempotencyKey = collectionIdempotencyKey(identity);
  const { data, error } = await service.from("integration_collection_jobs").upsert({
    client_id: clientId,
    connection_id: identity.connectionId,
    provider: identity.provider,
    external_account_id: identity.externalAccountId,
    date_from: identity.dateFrom,
    date_to: identity.dateTo,
    entity_level: identity.level,
    api_version: identity.apiVersion,
    contract_version: identity.contractVersion,
    idempotency_key: idempotencyKey,
    priority,
    status: "queued",
    next_attempt_at: new Date().toISOString(),
  }, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id,idempotency_key,status").maybeSingle();
  if (error) throw new Error(`Não foi possível enfileirar a coleta: ${error.message}`);
  return data;
}

export async function claimCollectionJob(service: SupabaseClient<Database>, now = new Date()) {
  const { data, error } = await service.rpc("claim_integration_collection_job", { p_now: now.toISOString() }).maybeSingle();
  if (error) throw new Error(`Não foi possível reivindicar a coleta: ${error.message}`);
  return data;
}

export async function persistCollectionResult(service: SupabaseClient<Database>, jobId: string, result: ProviderCollectionResult, status: "partial" | "confirmed", collectedAt = new Date().toISOString()) {
  const rawRows = result.rawPayloads.map((raw) => ({ job_id: jobId, provider: "meta", endpoint: raw.endpoint, response_payload: raw.payload as never, http_status: raw.httpStatus ?? null, collected_at: collectedAt }));
  if (rawRows.length) {
    const { error } = await service.from("integration_raw_payloads").insert(rawRows);
    if (error) throw new Error(`Não foi possível salvar o payload bruto: ${error.message}`);
  }
  const { data: job, error: jobError } = await service.from("integration_collection_jobs").select("client_id,provider,external_account_id,date_from,date_to,entity_level").eq("id", jobId).single();
  if (jobError || !job) throw new Error("Job de coleta não encontrado para criar o snapshot.");
  const { data, error } = await service.from("integration_snapshots").insert({
    job_id: jobId, client_id: job.client_id, provider: job.provider, external_account_id: job.external_account_id,
    date_from: job.date_from, date_to: job.date_to, entity_level: job.entity_level, status,
    payload: { metrics: result.metrics } as never, reconciliation: result.reconciliation as never, collected_at: collectedAt,
  }).select("id,status").single();
  if (error) throw new Error(`Não foi possível salvar o snapshot: ${error.message}`);
  const { error: updateError } = await service.from("integration_collection_jobs").update({ status, completed_at: status === "confirmed" ? collectedAt : null, updated_at: collectedAt }).eq("id", jobId);
  if (updateError) throw new Error(`Não foi possível atualizar o job: ${updateError.message}`);
  return data;
}
