import "server-only";

import { callRpc, type BillingDb } from "./db";

// Registro persistente de cada execução do /api/cron/billing e leitura da saúde do agendamento.
// Grava só identificador, ambiente, horários, estado, duração e CONTAGENS (nunca segredo, token, payload ou dado de cliente).
// Falha do monitoramento NUNCA derruba o cron: o trabalho financeiro tem prioridade sobre o seu próprio registro.

export type CronEnvironment = "sandbox" | "production";
export type CronRunStatus = "success" | "partial" | "failed";
export type CronRunSummary = { status: CronRunStatus; items: number; failures: number; counts: Record<string, number>; errorCode?: string };

type Num = number | undefined;
const n = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0);

/** Resume o resultado das três etapas do cron em contagens simples. */
export function summarizeCronResult(result: {
  maintenance?: Record<string, unknown> | null; events?: Record<string, unknown> | null; reconciliation?: Record<string, unknown> | null;
}): CronRunSummary {
  const m = result.maintenance ?? {}; const e = result.events ?? {}; const r = result.reconciliation ?? {};
  const counts: Record<string, number> = {
    maint_trials_expired: n(m.trials_expired), maint_intents_expired: n(m.intents_expired), maint_canceled: n(m.subscriptions_canceled),
    maint_suspended: n(m.subscriptions_suspended), maint_events_review: n(m.events_needing_review),
    ev_claimed: n(e.claimed), ev_processed: n(e.processed), ev_ignored: n(e.ignored), ev_needs_review: n(e.needs_review), ev_retry: n(e.retry), ev_deferred: n(e.deferred),
    rec_checked: n(r.checked), rec_remote_canceled: n(r.remoteCanceled), rec_failed: n(r.failed), rec_intents_checked: n(r.intentsChecked),
    rec_intents_resolved: n(r.intentsResolved), rec_intents_verified: n(r.intentsVerified),
  };
  const items = counts.maint_trials_expired + counts.maint_intents_expired + counts.maint_canceled + counts.maint_suspended + counts.ev_processed + counts.ev_ignored
    + counts.ev_needs_review + counts.rec_checked + counts.rec_remote_canceled + counts.rec_intents_checked;
  const failures = counts.ev_retry + counts.rec_failed;
  return { status: failures > 0 ? "partial" : "success", items, failures, counts };
}

/** Abre a execução; devolve o identificador ou null (monitoramento indisponível/migration ausente). */
export async function startCronRun(db: BillingDb, environment: CronEnvironment): Promise<string | null> {
  try {
    const id = await callRpc<unknown>(db, "billing_cron_start", { p_environment: environment });
    return typeof id === "string" ? id : null;
  } catch { return null; }
}

export async function finishCronRun(db: BillingDb, runId: string | null, summary: CronRunSummary): Promise<void> {
  if (!runId) return;
  try {
    await callRpc<unknown>(db, "billing_cron_finish", {
      p_id: runId, p_status: summary.status, p_items: summary.items, p_failures: summary.failures, p_counts: summary.counts, p_error_code: summary.errorCode ?? null,
    });
  } catch { /* o monitor não pode derrubar o cron */ }
}

export type CronHealth = {
  ok: boolean; flags: string[]; environment: CronEnvironment; now: string; last_run_at: string | null; last_run_status: string | null;
  last_success_at: string | null; minutes_since_success: Num | null; consecutive_non_success: number; runs_last_hour: number;
  backlog: { events_pending: number; oldest_pending_event_minutes: number; events_needing_review: number; subscriptions_not_reconciled: number; intents_expired_unresolved: number };
};

/** Saúde do cron para monitores externos. null = função de monitoramento ainda não instalada no banco. */
export async function readCronHealth(db: BillingDb, environment: CronEnvironment): Promise<CronHealth | null> {
  try {
    const value = await callRpc<unknown>(db, "billing_cron_health", { p_environment: environment });
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { ok?: unknown }).ok !== "boolean") return null;
    return value as CronHealth;
  } catch { return null; }
}
