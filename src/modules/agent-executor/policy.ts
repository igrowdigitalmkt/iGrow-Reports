import { z } from "zod";

/** Política PURA: falha fechada; nunca executa chamadas à Meta. */
export const ACTIONS = [
  "pause_campaign", "resume_campaign", "pause_adset", "resume_adset",
  "set_campaign_daily_budget", "set_adset_daily_budget",
] as const;
export type ActionKind = (typeof ACTIONS)[number];

const money = z.number().int().nonnegative().max(1_000_000_000_000);
const accountId = z.string().regex(/^act_[1-9]\d*$/);
const metaId = z.string().regex(/^[1-9]\d*$/);
const timestamp = z.iso.datetime({ offset: true });

export const proposalSchema = z.object({
  actionId: z.uuid(),
  action: z.enum(ACTIONS),
  targetId: metaId,
  adAccountId: accountId,
  dailyBudgetMinor: money.positive().optional(),
  factsCollectedAt: timestamp,
  rationale: z.string().trim().min(10).max(2000),
}).strict().superRefine((p, ctx) => {
  if (p.action.startsWith("set_") !== (p.dailyBudgetMinor !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["dailyBudgetMinor"], message: "Orçamento incompatível com ação." });
  }
});

export const delegationSchema = z.object({
  agencyId: z.uuid(), clientId: z.uuid(), adAccountId: accountId,
  enabled: z.boolean(), revokedAt: timestamp.nullable(), expiresAt: timestamp,
  allowedActions: z.array(z.enum(ACTIONS)).max(ACTIONS.length),
  maxAccountDailyBudgetMinor: money.positive(),
  maxEntityDailyBudgetMinor: money.positive(),
  maxIncreaseMinorPerAction: money.positive(),
  maxIncreasePercentPerAction: z.number().int().min(0).max(100),
}).strict();

export const accountContextSchema = z.object({
  agencyId: z.uuid(), clientId: z.uuid(), adAccountId: accountId,
  currency: z.string().regex(/^[A-Z]{3}$/),
  hasWritePermission: z.boolean(), userMayDelegate: z.boolean(),
  commercialAccessActive: z.boolean(), metaConnectionActive: z.boolean(),
  /** Soma confirmada dos orçamentos ativos na conta (não deduzir de métricas de gasto). */
  confirmedActiveDailyBudgetMinor: money.nullable(),
  /** É false se qualquer campanha/conjunto ativo não tem orçamento conhecido. */
  budgetCoverageComplete: z.boolean(),
}).strict();

export const entitySnapshotSchema = z.object({
  id: metaId, adAccountId: accountId, level: z.enum(["campaign", "adset"]),
  configuredStatus: z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "IN_PROCESS", "WITH_ISSUES"]),
  dailyBudgetMinor: money.nullable(),
  fetchedAt: timestamp,
}).strict();

export type ActionProposal = z.infer<typeof proposalSchema>;
export type Delegation = z.infer<typeof delegationSchema>;
export type AccountContext = z.infer<typeof accountContextSchema>;
export type EntitySnapshot = z.infer<typeof entitySnapshotSchema>;

export type AuthorizedOperation = {
  actionId: string;
  action: ActionKind;
  targetId: string;
  adAccountId: string;
  previousStatus: "ACTIVE" | "PAUSED";
  previousDailyBudgetMinor: number | null;
  requestedDailyBudgetMinor: number | null;
  rationale: string;
};
export type PolicyResult = { ok: true; operation: AuthorizedOperation } | { ok: false; reason: string };
export type PolicyInput = {
  proposal: unknown; delegation: unknown; context: unknown; entity: unknown; now: Date;
};

/** Autoriza SOMENTE proposta válida e recente, com conta, direito e delegação concordantes. */
export function evaluateDelegatedAction(input: PolicyInput): PolicyResult {
  const p = proposalSchema.safeParse(input.proposal);
  const d = delegationSchema.safeParse(input.delegation);
  const c = accountContextSchema.safeParse(input.context);
  const e = entitySnapshotSchema.safeParse(input.entity);
  const no = (reason: string): PolicyResult => ({ ok: false, reason });
  if (!p.success || !d.success || !c.success || !e.success) return no("Contrato inválido.");
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) return no("Relógio inválido.");
  const proposal = p.data, delegation = d.data, context = c.data, entity = e.data;
  const now = input.now.getTime();
  if (!delegation.enabled || delegation.revokedAt !== null || now >= Date.parse(delegation.expiresAt)) return no("Delegação inativa.");
  if (!delegation.allowedActions.includes(proposal.action)) return no("Ação fora da delegação.");
  if (delegation.agencyId !== context.agencyId || delegation.clientId !== context.clientId
    || delegation.adAccountId !== context.adAccountId || proposal.adAccountId !== context.adAccountId
    || entity.adAccountId !== context.adAccountId || proposal.targetId !== entity.id) return no("Identidade fora do escopo.");
  if (!context.hasWritePermission || !context.userMayDelegate || !context.commercialAccessActive || !context.metaConnectionActive) return no("Acesso indisponível.");
  const factsAge = now - Date.parse(proposal.factsCollectedAt);
  const entityAge = now - Date.parse(entity.fetchedAt);
  if (factsAge < 0 || entityAge < 0 || factsAge > 60 * 60_000 || entityAge > 5 * 60_000) return no("Fatos ou estado desatualizados.");
  const level = proposal.action.includes("campaign") ? "campaign" : "adset";
  if (level !== entity.level) return no("Entidade incompatível.");
  if (entity.configuredStatus !== "ACTIVE" && entity.configuredStatus !== "PAUSED") return no("Entidade indisponível.");
  const pause = proposal.action.startsWith("pause_");
  const resume = proposal.action.startsWith("resume_");
  if (pause && entity.configuredStatus !== "ACTIVE") return no("Entidade não está ativa.");
  if (resume && entity.configuredStatus !== "PAUSED") return no("Entidade não está pausada.");
  if (!pause && !resume && entity.configuredStatus !== "ACTIVE") return no("Alteração de orçamento exige entidade ativa.");

  if (!pause) {
    // Para reativar/aumentar orçamento, o usuário delega um teto de conta que DEVE
    // vir de inventário completo. Se não for possível calculá-lo, não há escrita.
    if (entity.dailyBudgetMinor === null || !context.budgetCoverageComplete
      || context.confirmedActiveDailyBudgetMinor === null) return no("Orçamento não confirmado.");
    const target = resume ? entity.dailyBudgetMinor : proposal.dailyBudgetMinor!;
    const increase = resume ? target : Math.max(target - entity.dailyBudgetMinor, 0);
    if (target > delegation.maxEntityDailyBudgetMinor
      || increase > delegation.maxIncreaseMinorPerAction
      || !Number.isSafeInteger(context.confirmedActiveDailyBudgetMinor + increase)
      || context.confirmedActiveDailyBudgetMinor + increase > delegation.maxAccountDailyBudgetMinor) return no("Limites financeiros excedidos.");
    if (!resume && increase > 0 && (entity.dailyBudgetMinor === 0
      || increase * 100 > entity.dailyBudgetMinor * delegation.maxIncreasePercentPerAction)) return no("Variação percentual excedida.");
  }
  return { ok: true, operation: {
    actionId: proposal.actionId, action: proposal.action, targetId: proposal.targetId,
    adAccountId: proposal.adAccountId, previousStatus: entity.configuredStatus,
    previousDailyBudgetMinor: entity.dailyBudgetMinor,
    requestedDailyBudgetMinor: proposal.action.startsWith("set_") ? proposal.dailyBudgetMinor! : null,
    rationale: proposal.rationale,
  } };
}
