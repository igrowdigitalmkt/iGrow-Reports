import { createHash } from "node:crypto";

/** Acoes desconhecidas sao financeiras ate revisao explicita de produto. */
export function aiChangeRequiresHumanApproval(action: string): boolean {
  switch (action) {
    case "pause_campaign":
    case "resume_campaign":
    case "pause_adset":
    case "resume_adset":
    case "set_campaign_daily_budget":
    case "set_adset_daily_budget":
      return true; // alteram gasto direto OU a veiculacao e seu efeito financeiro
    default:
      return true; // fail-closed para futuras criacoes, publicacoes e lances
  }
}

export type ApprovalTerms = {
  id: string;
  agency_id: string;
  client_id: string;
  ad_account_id: string;
  action_type: string;
  meta_entity_id: string;
  daily_budget_minor: number | null;
  rationale: string;
};

/** Mesmo contrato que private.agent_approval_fingerprint no PostgreSQL.
 * Nao e assinatura; vincula a confirmacao humana ao objeto imutavel.
 */
export function approvalFingerprint(job: ApprovalTerms): string {
  const terms = [job.id, job.agency_id, job.client_id, job.ad_account_id,
    job.action_type, job.meta_entity_id, job.daily_budget_minor === null
      ? "none" : String(job.daily_budget_minor), job.rationale];
  return createHash("sha256").update(terms.join(String.fromCharCode(31)), "utf8").digest("hex");
}
