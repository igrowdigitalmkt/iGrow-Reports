/** Contratos da análise operacional assistida por IA em Campanhas. Compartilhados entre servidor e cliente; sem segredos. */

/** Os cinco estados que o usuário enxerga, do mais leve ao mais concreto. */
export type OpportunityStage = "observation" | "recommendation" | "proposal" | "awaiting_approval" | "executed";
export const STAGE_ORDER: OpportunityStage[] = ["observation", "recommendation", "proposal", "awaiting_approval", "executed"];
export const STAGE_LABELS: Record<OpportunityStage, { label: string; hint: string }> = {
  observation: { label: "Observação", hint: "Algo que a IA notou nos dados. Não pede nenhuma ação." },
  recommendation: { label: "Recomendação", hint: "Leitura da IA sobre o conjunto. Não altera nada." },
  proposal: { label: "Proposta operacional", hint: "Ação concreta registrada, ainda não enviada para aprovação ou em processamento." },
  awaiting_approval: { label: "Aguardando aprovação", hint: "Nada é executado sem a aprovação específica de um proprietário ou administrador." },
  executed: { label: "Executada", hint: "Alteração enviada e confirmada na Meta." },
};

/** Estado do trabalho no ledger => estágio mostrado. Estados intermediários continuam "proposta" (nunca "executada" sem confirmação). */
export function stageForJobStatus(status: string): OpportunityStage | null {
  switch (status) {
    case "verified": return "executed";
    case "awaiting_approval": return "awaiting_approval";
    case "proposed": case "authorized": case "queued": case "executing": case "verifying": case "needs_verification": return "proposal";
    default: return null; // rejeitada, expirada ou não executada: fica só no histórico
  }
}

export type OpportunityAvailability =
  | { state: "available"; accounts: number }
  | { state: "unauthorized" | "engine_disabled" | "ai_unavailable" | "no_delegation" | "no_accounts" | "ai_budget" | "error"; message: string };

export type OpportunityObservation = { name: string; level: "campaign" | "adset" | "ad"; rationale: string };
export type OpportunityRun = {
  id: string; createdAt: string; origin: "manual" | "scheduled"; accountId: string | null;
  summary: string; observations: OpportunityObservation[]; proposals: number; blocked: number; rejected: number;
};
export type OpportunityJob = {
  id: string; accountId: string; action: string; entityId: string; dailyBudgetMinor: number | null;
  status: string; createdAt: string; expiresAt: string | null; expired: boolean; approved: boolean; failure: string | null;
  /** Justificativa da IA já validada pelo motor (números vindos dos fatos). Só propostas da IA chegam aqui. */
  reason: string;
};
export type OpportunityState = {
  availability: OpportunityAvailability; runs: OpportunityRun[]; jobs: OpportunityJob[];
  /** Escopo REAL da análise, para o usuário saber o que foi e o que não foi considerado. */
  scope: { windowDays: number; levels: string[]; actions: string[]; requiresApproval: true };
};

export type AnalyzeResult =
  | { ok: true; summary: { analyzedAccounts: number; skipped: { reason: string; message: string }[] }; state: OpportunityState }
  | { ok: false; code: "unauthorized" | "engine_disabled" | "ai_unavailable" | "no_delegation" | "ai_budget" | "no_accounts" | "error"; message: string; state?: OpportunityState };

export const SKIP_MESSAGES: Record<string, string> = {
  no_metrics: "Sem métricas suficientes no período para analisar esta conta.",
  live_state_unavailable: "Não foi possível confirmar o estado atual na Meta; nada foi analisado.",
  no_confirmed_entities: "Nenhuma entidade confirmada ao vivo na Meta.",
  duplicate_request: "Uma análise equivalente já foi feita nesta hora; nada novo foi gasto.",
  accounting_failed: "Não foi possível registrar o consumo de IA; a análise foi descartada.",
  ai_budget: "O orçamento mensal de IA foi atingido; a análise parou.",
  ai_unavailable: "A IA ficou indisponível para esta organização; a análise parou.",
  invalid_output: "A IA devolveu uma resposta inválida; nada foi proposto.",
  unverified_numbers: "A IA citou números que não estão nos dados; a resposta foi descartada.",
  stale_facts: "Os dados ficaram desatualizados durante a análise; nada foi proposto.",
  model_error: "O serviço de IA não respondeu; nada foi proposto.",
};
export const skipMessage = (reason: string) => SKIP_MESSAGES[reason.split(":")[0] ?? ""] ?? "Esta conta não pôde ser analisada agora.";

/** Escopo REAL do ciclo de decisão (decision-cycle.ts/decision-validator): é o que a tela declara ao usuário, sem prometer mais. */
export const ANALYSIS_SCOPE: OpportunityState["scope"] = {
  windowDays: 14, levels: ["campanha", "conjunto de anúncios"],
  actions: ["pausar", "retomar", "alterar o orçamento diário"], requiresApproval: true,
};
