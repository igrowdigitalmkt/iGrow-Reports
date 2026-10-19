import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createAnthropicDecisionModel } from "./anthropic-decision-model";
import { runDecisionCycle } from "./decision-cycle";
import type { DecisionModel } from "./decision-engine";
import { decisionEngineEnabled } from "./decision-engine";
import { reconcileUncertainJobs, type ReconcileReport } from "./reconciler";
import { runQueuedAgentJob, type WorkerResult } from "./worker";

type Service = SupabaseClient<Database>;

/** Interruptor mestre do agendador. Desligado por padrao: nada roda sem `AGENT_SCHEDULER_ENABLED=true`. */
export function agentSchedulerEnabled(env: Record<string, string | undefined> = process.env) {
  return env.AGENT_SCHEDULER_ENABLED === "true";
}

const DECISION_COOLDOWN_MS = 12 * 3_600_000;
const MAX_CLIENTS_PER_RUN = 5;
const MAX_JOBS_PER_RUN = 10;
const ATTENTION_AFTER_MS = 24 * 3_600_000;

export type SchedulerDeps = {
  now?: () => Date;
  model?: DecisionModel;
  runJob?: typeof runQueuedAgentJob;
  decisionsEnabled?: boolean;
};
export type SchedulerReport =
  | { enabled: false }
  | {
    enabled: true;
    expired: number;
    reconciled: ReconcileReport[];
    executed: WorkerResult[];
    skippedByGate: number;
    decisions: { clients: number; analyzed: number };
    /** Jobs sem solucao ha mais de 24h; precisam de atencao humana (a conta segue bloqueada). */
    needsAttention: string[];
  };

/**
 * Um passe do agente: (1) expira solicitacoes vencidas, (2) concilia resultados incertos (so leitura),
 * (3) executa jobs aprovados/solicitados, (4) analisa clientes com delegacao. Server-only, acionado
 * apenas pelo cron autenticado. Cada fase falha isolada e fechada; o gate comercial global (OFF por
 * padrao) continua mandando em qualquer escrita.
 */
export async function runAgentScheduler(service: Service, deps: SchedulerDeps = {}): Promise<SchedulerReport> {
  if (!agentSchedulerEnabled()) return { enabled: false };
  const now = deps.now?.() ?? new Date();
  const iso = now.toISOString();

  // 1. Prazos: aprovacao nao dada e fila nao executada a tempo viram `expired`, liberando a conta.
  let expired = 0;
  for (const status of ["awaiting_approval", "queued"] as const) {
    const { data } = await service.from("agent_action_jobs").update({ status: "expired" })
      .eq("status", status).eq("execution_origin", "ai").lt("approval_expires_at", iso).select("id");
    expired += data?.length ?? 0;
  }

  // 2. Reconciliacao.
  const reconciled = await reconcileUncertainJobs(service, { now: () => now });

  // 3. Execucao. O gate comercial e conferido ANTES do claim para nao consumir job com o executor desligado.
  const executed: WorkerResult[] = [];
  let skippedByGate = 0;
  const { data: queued } = await service.from("agent_action_jobs").select("id,agency_id,execution_origin")
    .eq("status", "queued").order("queued_at", { ascending: true }).limit(MAX_JOBS_PER_RUN);
  const gate = new Map<string, boolean>();
  for (const job of queued ?? []) {
    if (!gate.has(job.agency_id)) {
      const { data } = await service.rpc("agent_meta_execution_allowed", { p_agency_id: job.agency_id });
      gate.set(job.agency_id, data === true);
    }
    if (!gate.get(job.agency_id)) { skippedByGate += 1; continue; }
    executed.push(await (deps.runJob ?? runQueuedAgentJob)(
      { agencyId: job.agency_id, jobId: job.id },
      { service, runtimeDeps: { origin: job.execution_origin === "manual" ? "manual" : "ai" } },
    ));
  }

  // 4. Decisao: so clientes com delegacao vigente, sem aprovacao pendente e fora do periodo de espera.
  const decisions = { clients: 0, analyzed: 0 };
  if (deps.decisionsEnabled ?? decisionEngineEnabled()) {
    const { data: grants } = await service.from("agent_delegations").select("agency_id,client_id,enabled,revoked_at,expires_at");
    const clients = new Map<string, { agencyId: string; clientId: string }>();
    for (const g of grants ?? []) {
      if (g.enabled && !g.revoked_at && Date.parse(g.expires_at) > now.getTime()) clients.set(g.client_id, { agencyId: g.agency_id, clientId: g.client_id });
    }
    decisions.clients = clients.size;
    const model = deps.model ?? createAnthropicDecisionModel();
    for (const scope of [...clients.values()]) {
      if (decisions.analyzed >= MAX_CLIENTS_PER_RUN) break;
      const [{ data: pending }, { data: recent }] = await Promise.all([
        service.from("agent_action_jobs").select("id").eq("agency_id", scope.agencyId).eq("client_id", scope.clientId)
          .eq("status", "awaiting_approval").limit(1),
        service.from("ai_usage").select("id").eq("agency_id", scope.agencyId).eq("client_id", scope.clientId)
          .eq("feature", "agent_decision").gte("created_at", new Date(now.getTime() - DECISION_COOLDOWN_MS).toISOString()).limit(1),
      ]);
      if ((pending?.length ?? 0) > 0 || (recent?.length ?? 0) > 0) continue;
      try {
        const result = await runDecisionCycle(service, scope, { model, now: () => now, enabled: true });
        if (result.ok) decisions.analyzed += 1;
      } catch { /* um cliente com falha nao interrompe os demais */ }
    }
  }

  // 5. Atencao: incerteza antiga sem solucao.
  const { data: stuck } = await service.from("agent_action_jobs").select("id")
    .eq("status", "needs_verification").lt("updated_at", new Date(now.getTime() - ATTENTION_AFTER_MS).toISOString()).limit(50);
  return {
    enabled: true, expired, reconciled, executed, skippedByGate, decisions,
    needsAttention: (stuck ?? []).map(j => j.id),
  };
}
