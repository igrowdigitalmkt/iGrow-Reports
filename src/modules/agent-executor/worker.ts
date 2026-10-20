import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
import { executeMetaWrite, type MetaWriteDeps } from "./meta-write";
import { resolveAgentRuntime, type AgentRuntime, type RuntimeDeps } from "./runtime";

type Service = SupabaseClient<Database>;
type Identity = { agencyId: string; jobId: string };
export type WorkerResult =
  | { status: "not_claimed" | "unavailable" | "failed" | "verified" | "needs_verification"; jobId: string };

type WorkerDeps = {
  service?: Service;
  resolver?: (service: Service, identity: Identity, deps?: RuntimeDeps) => Promise<AgentRuntime>;
  writer?: typeof executeMetaWrite;
  runtimeDeps?: RuntimeDeps;
  metaDeps?: Pick<MetaWriteDeps, "fetchImpl" | "now">;
};

/** CAS: nenhuma alteracao de status acontece fora da transicao esperada. */
async function transition(
  service: Service, identity: Identity, from: string, to: string,
  patch: { failure_code?: string | null; provider_ref?: string | null } = {},
) {
  const { data, error } = await service.from("agent_action_jobs")
    .update({ ...patch, status: to })
    .eq("agency_id", identity.agencyId).eq("id", identity.jobId)
    .eq("status", from).select("id").maybeSingle();
  if (error || !data) throw new Error("agent_ledger_transition_failed");
}
async function snapshot(service: Service, identity: Identity, column: "before_state" | "after_state", state: Json) {
  const { data, error } = await service.from("agent_action_jobs")
    .update(column === "before_state" ? { before_state: state } : { after_state: state })
    .eq("agency_id", identity.agencyId).eq("id", identity.jobId)
    .eq("status", "executing").select("id").maybeSingle();
  if (error || !data) throw new Error("agent_ledger_snapshot_failed");
}

/**
 * Ponto de entrada EXCLUSIVO de servidor/worker. Sem rota, cron ou comando do modelo.
 * Requer job previamente autorizado e enfileirado via fluxo transacional.
 * Claim e irrevogavel: crash apos claim permanece travado ate reconciliacao.
 */
export async function runQueuedAgentJob(identity: Identity, deps: WorkerDeps = {}): Promise<WorkerResult> {
  const service = deps.service ?? createSupabaseServiceClient();
  if (!service) return { status: "unavailable", jobId: identity.jobId };
  const { data: claimed, error: claimError } = await service.rpc("agent_claim_action", {
    p_agency_id: identity.agencyId, p_job_id: identity.jobId,
  });
  if (claimError) return { status: "unavailable", jobId: identity.jobId };
  if (claimed !== true) return { status: "not_claimed", jobId: identity.jobId };

  let runtime: AgentRuntime;
  try {
    runtime = await (deps.resolver ?? resolveAgentRuntime)(service, identity, deps.runtimeDeps);
  } catch {
    // Somente preflight falhou. Nenhum POST foi enviado.
    await transition(service, identity, "executing", "failed", { failure_code: "preflight_denied" });
    return { status: "failed", jobId: identity.jobId };
  }

  // A partir deste ponto todo erro de efeito externo e tratado como INCERTO.
  // Nunca repete o POST nem desobstrui a conta ate conciliacao independente.
  try {
    const result = await (deps.writer ?? executeMetaWrite)({
      ...runtime, proposal: runtime.proposal, delegation: runtime.delegation,
      context: runtime.context,
    }, {
      ...deps.metaDeps,
      beforePost: async (op, state) => {
        // Reconsulta delegacao, vinculos, financeiro e permissao Meta IMEDIATAMENTE
        // antes da mutacao. Revogacao durante preflight bloqueia o POST.
        await (deps.resolver ?? resolveAgentRuntime)(service, identity, deps.runtimeDeps);
        await snapshot(service, identity, "before_state", {
          meta_entity_id: op.targetId, action: op.action,
          previous_status: state.status, previous_daily_budget_minor: state.dailyBudgetMinor,
          ...(state.name != null ? { previous_name: state.name } : {}),
          checked_at: new Date().toISOString(),
        });
      },
      afterVerified: async (op, state) => {
        await snapshot(service, identity, "after_state", {
          meta_entity_id: op.targetId, action: op.action,
          confirmed_status: state.status, confirmed_daily_budget_minor: state.dailyBudgetMinor,
          ...(state.name != null ? { confirmed_name: state.name } : {}),
          checked_at: new Date().toISOString(),
        });
      },
    });
    if (result.status === "blocked") {
      await transition(service, identity, "executing", "failed", { failure_code: "policy_blocked" });
      return { status: "failed", jobId: identity.jobId };
    }
    if (result.status === "needs_verification") {
      await transition(service, identity, "executing", "needs_verification", { failure_code: "provider_uncertain" });
      return { status: "needs_verification", jobId: identity.jobId };
    }
    await transition(service, identity, "executing", "verifying");
    await transition(service, identity, "verifying", "verified", { provider_ref: result.metaEntityId });
    return { status: "verified", jobId: identity.jobId };
  } catch {
    // Se uma transicao falhou, pode continuar "executing"; unica por conta
    // impede quaisquer novas escritas ate investigacao/reconciliacao.
    try { await transition(service, identity, "executing", "needs_verification", { failure_code: "worker_uncertain" }); }
    catch { /* preserva trava executing, sem reenvio */ }
    return { status: "needs_verification", jobId: identity.jobId };
  }
}
