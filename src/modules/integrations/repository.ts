import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { collectionIdempotencyKey, type CollectionIdentity } from "./data-contract";
import type { ProviderCollectionResult } from "./worker-contract";

export async function enqueueCollectionJob(service: SupabaseClient<Database>, identity: CollectionIdentity, priority = 100) {
  const idempotencyKey = collectionIdempotencyKey(identity);
  const { data, error } = await service.from("integration_collection_jobs").upsert({
    client_id: identity.clientId,
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

export async function authorizeCollectionJob(service: SupabaseClient<Database>, jobId: string, attemptCount: number): Promise<string | null> {
  const { data, error } = await service.rpc("authorize_integration_collection_job", { p_job_id: jobId, p_attempt_count: attemptCount });
  if (error?.code === "42501") return null;
  if (error || !data) throw new Error("Não foi possível validar a autorização da tentativa de coleta.");
  return data;
}

export async function recordProviderHealth(service: SupabaseClient<Database>, integrationId: string, provider: string, event: { ok: boolean; errorCode?: string; latencyMs?: number }) {
  const { data, error } = await service.rpc("record_integration_provider_health", {
    p_integration_id: integrationId,
    p_provider: provider,
    p_ok: event.ok,
    p_error_code: event.errorCode ?? null,
    p_latency_ms: event.latencyMs ?? null,
  }).single();
  if (error) throw new Error(`Não foi possível registrar a saúde da integração: ${error.message}`);
  return data;
}

export async function finishCollectionJob(service: SupabaseClient<Database>, jobId: string, attemptCount: number, transition: { status: "partial" | "confirmed" | "failed"; nextAttemptAt?: string | null; errorCode?: string; errorMessage?: string; completedAt?: string | null }) {
  const { error } = await service.rpc("finish_integration_collection_job", {
    p_job_id: jobId,
    p_attempt_count: attemptCount,
    p_status: transition.status,
    p_next_attempt_at: transition.nextAttemptAt ?? null,
    p_error_code: transition.errorCode ?? null,
    p_error_message: transition.errorMessage ?? null,
    p_completed_at: transition.completedAt ?? (transition.status === "confirmed" ? new Date().toISOString() : null),
  });
  if (error) throw new Error(`Não foi possível finalizar o job de coleta: ${error.message}`);
}

export async function persistCollectionResult(service: SupabaseClient<Database>, jobId: string, attemptCount: number, result: ProviderCollectionResult, status: "partial" | "confirmed") {
  const { data, error } = await service.rpc("persist_integration_collection_result", {
    p_job_id: jobId,
    p_attempt_count: attemptCount,
    p_status: status,
    p_metrics: result.metrics as unknown as Json,
    p_reconciliation: result.reconciliation as Json,
    p_raw_payloads: result.rawPayloads as unknown as Json,
  });
  if (error) throw new Error(`Não foi possível salvar o resultado da coleta: ${error.message}`);
  return data;
}
