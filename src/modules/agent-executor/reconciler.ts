import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { readLiveEntityState, type LiveEntityState, type LiveStateDeps } from "./decision-live-state";

type Service = SupabaseClient<Database>;
type Job = Database["public"]["Tables"]["agent_action_jobs"]["Row"];

/** Espera minima, apos o inicio, para concluir que a Meta NAO aplicou a mudanca (consistencia eventual). */
export const NOT_APPLIED_AFTER_MS = 15 * 60_000;
/** `executing` sem progresso por este tempo e tratado como worker interrompido. */
export const STALE_EXECUTING_AFTER_MS = 10 * 60_000;

export type ReconcileOutcome =
  | "verified" | "failed_not_applied" | "failed_not_sent" | "inconclusive" | "too_soon" | "lost_race";
export type ReconcileReport = { jobId: string; outcome: ReconcileOutcome };

type Before = { status: string | null; dailyBudgetMinor: number | null };
function readBefore(value: Json | null): Before | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = value.previous_status, budget = value.previous_daily_budget_minor;
  if (typeof status !== "string") return null;
  if (budget !== null && budget !== undefined && !(typeof budget === "number" && Number.isSafeInteger(budget))) return null;
  return { status, dailyBudgetMinor: (budget as number | null | undefined) ?? null };
}

/**
 * Classificacao PURA do estado ao vivo contra o que o job pretendia. Conservadora:
 * qualquer ambiguidade e `inconclusive` e o job permanece bloqueando a conta.
 */
export function classifyReconciliation(
  job: Pick<Job, "action_type" | "daily_budget_minor" | "before_state" | "started_at" | "created_at">,
  live: LiveEntityState | undefined, expectedAccount: string, now: Date,
): "applied" | "not_applied" | "too_soon" | "inconclusive" {
  const before = readBefore(job.before_state);
  if (!before || !live || live.accountExternalId !== expectedAccount || !live.configuredStatus) return "inconclusive";
  const wantStatus = job.action_type.startsWith("pause_") ? "PAUSED"
    : job.action_type.startsWith("resume_") ? "ACTIVE" : before.status;
  const wantBudget = job.daily_budget_minor === null ? null : Number(job.daily_budget_minor);
  const applied = live.configuredStatus === wantStatus && (wantBudget === null || live.dailyBudgetMinor === wantBudget);
  const unchanged = live.configuredStatus === before.status && live.dailyBudgetMinor === before.dailyBudgetMinor;
  if (applied === unchanged) return "inconclusive"; // ambos (nao-op) ou nenhum (alterado por terceiros)
  if (applied) return "applied";
  const age = now.getTime() - Date.parse(job.started_at ?? job.created_at);
  return Number.isFinite(age) && age >= NOT_APPLIED_AFTER_MS ? "not_applied" : "too_soon";
}

async function cas(service: Service, job: Job, from: string, to: string, patch: Partial<Job> = {}) {
  const { data, error } = await service.from("agent_action_jobs").update({ ...patch, status: to })
    .eq("agency_id", job.agency_id).eq("id", job.id).eq("status", from).select("id").maybeSingle();
  return !error && !!data;
}

export type ReconcilerDeps = { now?: () => Date; limit?: number; liveDeps?: LiveStateDeps };

/**
 * Concilia resultados incertos SOMENTE por leitura (GET) na Meta. Nunca envia POST, nunca
 * reaplica e nunca aprova nada: resolve o ledger e libera (ou mantem) a trava da conta.
 * Uma nova tentativa exige uma nova proposta com nova aprovacao humana individual.
 * Entry point de servidor; sem rota, cron ou comando do modelo.
 */
export async function reconcileUncertainJobs(service: Service, deps: ReconcilerDeps = {}): Promise<ReconcileReport[]> {
  const now = deps.now?.() ?? new Date();
  const { data: jobs, error } = await service.from("agent_action_jobs").select("*")
    .in("status", ["needs_verification", "executing"]).order("created_at", { ascending: true }).limit(deps.limit ?? 25);
  if (error || !jobs) return [];
  const reports: ReconcileReport[] = [];
  for (const job of jobs) {
    const report = (outcome: ReconcileOutcome) => reports.push({ jobId: job.id, outcome });
    if (job.execution_origin !== "ai") { report("inconclusive"); continue; }
    const startedAt = Date.parse(job.started_at ?? job.created_at);
    if (job.status === "executing" && now.getTime() - startedAt < STALE_EXECUTING_AFTER_MS) { report("too_soon"); continue; }

    // O before_state e gravado ANTES do POST. Sem ele, nenhum POST pode ter sido enviado.
    if (job.status === "executing" && job.before_state === null) {
      report(await cas(service, job, "executing", "failed", { failure_code: "reconciled_not_sent" }) ? "failed_not_sent" : "lost_race");
      continue;
    }
    const { data: account } = await service.from("meta_ad_accounts").select("external_id")
      .eq("agency_id", job.agency_id).eq("id", job.ad_account_id).maybeSingle();
    const states = account ? await readLiveEntityState(
      service, { agencyId: job.agency_id, clientId: job.client_id, adAccountId: job.ad_account_id },
      [job.meta_entity_id], deps.liveDeps) : null;
    const verdict = account ? classifyReconciliation(job, states?.get(job.meta_entity_id), account.external_id, now) : "inconclusive";

    if (verdict === "applied") {
      const live = states!.get(job.meta_entity_id)!;
      // Registra que a prova veio da conciliacao por estado, nao da confirmacao imediata do worker.
      const afterState: Json = {
        meta_entity_id: job.meta_entity_id, action: job.action_type, confirmed_status: live.configuredStatus,
        confirmed_daily_budget_minor: live.dailyBudgetMinor, checked_at: now.toISOString(), reconciled: true,
      };
      let ok = true;
      if (job.status === "executing") ok = await cas(service, job, "executing", "verifying");
      const from = job.status === "executing" ? "verifying" : job.status;
      ok = ok && await cas(service, job, from, "verified", { after_state: afterState, provider_ref: job.meta_entity_id, failure_code: null });
      report(ok ? "verified" : "lost_race");
    } else if (verdict === "not_applied") {
      report(await cas(service, job, job.status, "failed", { failure_code: "reconciled_not_applied" }) ? "failed_not_applied" : "lost_race");
    } else report(verdict);
  }
  return reports;
}
