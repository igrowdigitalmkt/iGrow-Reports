import "server-only";

import type { ReportFacts } from "@/modules/reports/report-facts";
import { COMMENT_SYSTEM_PROMPT } from "./comment-prompt";
import { AI_MODEL, DEFAULT_MONTHLY_BUDGET_USD, estimateCostUsd, runGuardedGeneration, type GuardedDeps, type GuardedResult, type UsageTokens } from "./guarded-text";
import { formatFactsForPrompt } from "./prompt-facts";

export { DEFAULT_MONTHLY_BUDGET_USD, estimateCostUsd };
export type { UsageTokens };
export const COMMENT_MODEL = AI_MODEL;

export type CommentInput = { agencyId: string; clientId: string; userId: string | null; facts: ReportFacts; profile?: Record<string, string> | null; sourceRef?: string };
export type CommentResult = GuardedResult;
export type CommentDeps = GuardedDeps;

// Comentário de um relatório: fatos do cliente e do período, perfil opcional e o prompt dos cinco destaques.
export function generateReportComment(input: CommentInput, deps: CommentDeps = {}): Promise<CommentResult> {
  return runGuardedGeneration({
    agencyId: input.agencyId, clientId: input.clientId, userId: input.userId, feature: "report_comment",
    system: COMMENT_SYSTEM_PROMPT, factsLabel: "Fatos confirmados do período (JSON):",
    factsText: JSON.stringify(formatFactsForPrompt(input.facts, input.profile), null, 2), sourceRef: input.sourceRef,
  }, deps);
}
