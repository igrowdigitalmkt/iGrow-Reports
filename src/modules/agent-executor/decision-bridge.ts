import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { AgentQueueError, stageMetaDecision } from "./queue";
import type { ValidatedDecision } from "./decision-validator";

export type StageOutcome =
  | { ref: string; status: "awaiting_approval"; jobId: string; deduplicated: boolean }
  | { ref: string; status: "recommendation_only" | "blocked"; reason: string };

/**
 * Leva decisoes validadas ate a fila. Escopo (organizacao/cliente/conta interna/ciclo)
 * vem do servidor. Tudo entra como `awaiting_approval`: nenhum caminho aprova ou executa.
 * Acoes que a fila ainda nao aceita (retomar/orcamento) permanecem so como recomendacao.
 */
export async function stageValidatedDecisions(
  service: SupabaseClient<Database>,
  scope: { agencyId: string; clientId: string; observationId: string; factsCollectedAt: string },
  decision: ValidatedDecision,
  now: Date = new Date(),
): Promise<StageOutcome[]> {
  const outcomes: StageOutcome[] = [];
  for (const item of decision.accepted) {
    const ref = item.target.ref;
    if (!item.action.startsWith("pause_")) {
      outcomes.push({ ref, status: "recommendation_only", reason: "financial_inventory_pending" });
      continue;
    }
    try {
      const job = await stageMetaDecision(service, { ...scope, adAccountId: item.target.adAccountId }, {
        action: item.action, targetId: item.target.metaId, rationale: item.rationale,
      }, now);
      outcomes.push({ ref, status: "awaiting_approval", jobId: job.id, deduplicated: job.deduplicated });
    } catch (error) {
      if (!(error instanceof AgentQueueError)) throw error;
      outcomes.push({ ref, status: "blocked", reason: error.code });
    }
  }
  return outcomes;
}
