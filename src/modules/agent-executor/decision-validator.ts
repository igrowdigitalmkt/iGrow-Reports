import { verifyNumbers } from "@/modules/ai/number-guard";
import { decisionOutputSchema, type Recommendation } from "./decision-contract";
import type { DecisionFacts, FactTarget } from "./decision-facts";
import { aiChangeRequiresHumanApproval } from "./financial-approval";

/**
 * Validacao DETERMINISTICA da saida do modelo. Nada aqui consulta rede ou banco.
 * Uma recomendacao aceita ainda nao e execucao: `routing` apenas diz o que o
 * servidor pode fazer em seguida. Acao financeira (ou desconhecida) = aprovacao humana.
 */
export type Routing =
  | "informational"          // sem alteracao (no_action)
  | "needs_human_approval";  // qualquer mutacao financeira ou de veiculacao

export type AcceptedRecommendation = {
  action: Exclude<Recommendation["action"], "no_action">;
  target: FactTarget;
  rationale: string;
  confidence: Recommendation["confidence"];
  routing: "needs_human_approval";
  /** Valor absoluto calculado NO SERVIDOR a partir do orcamento confirmado. */
  dailyBudgetMinor: number | null;
};
export type RejectedRecommendation = { index: number; reason: string };

export type ValidatedDecision = {
  summary: string;
  accepted: AcceptedRecommendation[];
  observations: { targetRef: string; rationale: string }[];
  rejected: RejectedRecommendation[];
};
export type ValidationResult =
  | { ok: true; decision: ValidatedDecision }
  | { ok: false; reason: "invalid_output" | "stale_facts" | "unverified_numbers"; unverified?: string[] };

const MAX_FACTS_AGE_MS = 60 * 60_000;

/**
 * Numeros que a IA pode citar: os literais dos fatos e seus ARREDONDAMENTOS (0 a 2 casas). Arredondar um valor
 * confirmado nao e inventar; qualquer numero que nao derive de um valor real continua bloqueado.
 */
export function allowedNumberSources(factsText: string): string[] {
  const rounded = new Set<string>();
  for (const token of factsText.match(/\d+\.\d+/g) ?? []) {
    const n = Number(token);
    if (!Number.isFinite(n)) continue;
    for (const places of [0, 1, 2]) rounded.add(n.toFixed(places));
  }
  return [factsText, [...rounded].join(" ")];
}
export const SUMMARY_OMITTED = "Resumo omitido: continha numeros que nao constam nos dados confirmados.";

export function validateModelDecision(raw: unknown, facts: DecisionFacts, now: Date): ValidationResult {
  const parsed = decisionOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid_output" };
  const age = now.getTime() - Date.parse(facts.collectedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_FACTS_AGE_MS) return { ok: false, reason: "stale_facts" };

  // O resumo e fala livre: com numero fora dos fatos ele e OMITIDO (nunca exibido), mas as recomendacoes,
  // que sao conferidas uma a uma, seguem valendo.
  const allowed = allowedNumberSources(facts.factsText);
  const summaryCheck = verifyNumbers(parsed.data.summary, allowed);
  const out: ValidatedDecision = {
    summary: summaryCheck.ok ? parsed.data.summary : SUMMARY_OMITTED,
    accepted: [], observations: [], rejected: [],
  };
  const claimed = new Set<string>();

  parsed.data.recommendations.forEach((rec, index) => {
    const reject = (reason: string) => out.rejected.push({ index, reason });
    const target = facts.targets.get(rec.targetRef);
    if (!target) return reject("unknown_target");
    if (!rec.evidenceRefs.includes(rec.targetRef) || rec.evidenceRefs.some(r => !facts.targets.has(r))) return reject("invalid_evidence");
    const numbers = verifyNumbers(rec.rationale, [...allowed, rec.budgetChangePercent ?? ""]);
    if (!numbers.ok) return reject("unverified_numbers");

    if (rec.action === "no_action") {
      if (rec.budgetChangePercent !== undefined) return reject("unexpected_budget");
      out.observations.push({ targetRef: rec.targetRef, rationale: rec.rationale });
      return;
    }
    if ((rec.action.includes("campaign") ? "campaign" : "adset") !== target.level) return reject("level_mismatch");
    const wantsBudget = rec.action.startsWith("set_");
    if (wantsBudget !== (rec.budgetChangePercent !== undefined)) return reject("budget_mismatch");
    if (rec.action.startsWith("pause_") && target.status !== "ACTIVE") return reject("not_active");
    if (rec.action.startsWith("resume_") && target.status !== "PAUSED") return reject("not_paused");
    if (wantsBudget && target.status !== "ACTIVE") return reject("not_active");

    let dailyBudgetMinor: number | null = null;
    if (wantsBudget) {
      if (target.dailyBudgetMinor === null || target.dailyBudgetMinor <= 0) return reject("budget_unknown");
      dailyBudgetMinor = Math.round(target.dailyBudgetMinor * (100 + rec.budgetChangePercent!) / 100);
      if (!Number.isSafeInteger(dailyBudgetMinor) || dailyBudgetMinor <= 0) return reject("budget_invalid");
    }
    // Uma unica alteracao por entidade por ciclo evita decisoes conflitantes.
    const key = `${target.level}:${target.metaId}`;
    if (claimed.has(key)) return reject("conflicting_action");
    claimed.add(key);

    // Fail-closed: o roteamento nao e escolha do modelo.
    if (!aiChangeRequiresHumanApproval(rec.action)) return reject("unclassified_action");
    out.accepted.push({
      action: rec.action, target, rationale: rec.rationale, confidence: rec.confidence,
      routing: "needs_human_approval", dailyBudgetMinor,
    });
  });
  return { ok: true, decision: out };
}
