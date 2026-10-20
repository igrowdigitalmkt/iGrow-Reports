import { z } from "zod";

/** Política PURA: falha fechada; nunca executa chamadas à Meta. */
export const ACTIONS = [
  "pause_campaign", "resume_campaign", "pause_adset", "resume_adset",
  "set_campaign_daily_budget", "set_adset_daily_budget",
] as const;
export type ActionKind = (typeof ACTIONS)[number];

/**
 * Ações SOMENTE MANUAIS (clique do usuário autenticado). Ficam FORA de `ACTIONS` de propósito: a lista da IA (contrato de decisão, fila e
 * aprovação) continua com as seis ações anteriores, e o banco rejeita estas cinco para `execution_origin = 'ai'`.
 */
export const MANUAL_ONLY_ACTIONS = ["rename_campaign", "rename_adset", "rename_ad", "pause_ad", "resume_ad"] as const;
export const MANUAL_ACTIONS = [...ACTIONS, ...MANUAL_ONLY_ACTIONS] as const;
export type ManualActionKind = (typeof MANUAL_ACTIONS)[number];
export const isManualOnlyAction = (action: string): boolean => (MANUAL_ONLY_ACTIONS as readonly string[]).includes(action);
export type EntityLevel = "campaign" | "adset" | "ad";
/** Nível da entidade-alvo de cada ação (adset contém "ad": a ordem importa). */
export function actionLevel(action: ManualActionKind): EntityLevel {
  return action.endsWith("_campaign") ? "campaign" : action.endsWith("_adset") ? "adset" : action.startsWith("set_campaign") ? "campaign" : action.startsWith("set_adset") ? "adset" : "ad";
}
/** Ações que podem aumentar ou alterar o gasto: exigem orçamento confirmado e inventário (retomar campanha/conjunto e alterar orçamento). */
export const isBudgetSensitiveAction = (action: ManualActionKind): boolean =>
  action === "resume_campaign" || action === "resume_adset" || action.startsWith("set_");
export const isRenameAction = (action: string) => action.startsWith("rename_");

/** Limite conservador da Groow para nomes (o banco aceita até 400); sem espaços nas pontas, sem caracteres de controle. */
export const MAX_ENTITY_NAME_LENGTH = 200;
export function validateEntityName(name: unknown, current?: string | null): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof name !== "string") return { ok: false, message: "Informe o novo nome." };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: "O nome não pode ficar vazio." };
  if (trimmed.length > MAX_ENTITY_NAME_LENGTH) return { ok: false, message: `O nome pode ter no máximo ${MAX_ENTITY_NAME_LENGTH} caracteres.` };
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(trimmed)) return { ok: false, message: "O nome contém caracteres não permitidos." };
  if (current != null && trimmed === current) return { ok: false, message: "O novo nome é igual ao atual." };
  return { ok: true, name: trimmed };
}

/** Delegacoes da IA continuam limitadas a 100% por coluna no banco; o manual pode ir ate este valor. */
export const MANUAL_MAX_INCREASE_PERCENT = 1000;
const money = z.number().int().nonnegative().max(1_000_000_000_000);
const accountId = z.string().regex(/^act_[1-9]\d*$/);
const metaId = z.string().regex(/^[1-9]\d*$/);
const timestamp = z.iso.datetime({ offset: true });

export const proposalSchema = z.object({
  actionId: z.uuid(),
  action: z.enum(MANUAL_ACTIONS),
  targetId: metaId,
  adAccountId: accountId,
  dailyBudgetMinor: money.positive().optional(),
  /** Novo nome (somente ações rename_*). */
  newName: z.string().max(400).optional(),
  factsCollectedAt: timestamp,
  rationale: z.string().trim().min(10).max(2000),
}).strict().superRefine((p, ctx) => {
  if (p.action.startsWith("set_") !== (p.dailyBudgetMinor !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["dailyBudgetMinor"], message: "Orçamento incompatível com ação." });
  }
  if (isRenameAction(p.action) !== (p.newName !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["newName"], message: "Nome incompatível com ação." });
  } else if (p.newName !== undefined && !validateEntityName(p.newName).ok) {
    ctx.addIssue({ code: "custom", path: ["newName"], message: "Nome inválido." });
  }
});

export const delegationSchema = z.object({
  agencyId: z.uuid(), clientId: z.uuid(), adAccountId: accountId,
  enabled: z.boolean(), revokedAt: timestamp.nullable(), expiresAt: timestamp,
  allowedActions: z.array(z.enum(MANUAL_ACTIONS)).max(MANUAL_ACTIONS.length),
  maxAccountDailyBudgetMinor: money.positive(),
  maxEntityDailyBudgetMinor: money.positive(),
  maxIncreaseMinorPerAction: money.positive(),
  maxIncreasePercentPerAction: z.number().int().min(0).max(MANUAL_MAX_INCREASE_PERCENT),
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
  id: metaId, adAccountId: accountId, level: z.enum(["campaign", "adset", "ad"]),
  /** Nome atual lido na Meta (usado para recusar renomeação sem mudança). */
  name: z.string().max(1000).nullable().optional(),
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
  action: ManualActionKind;
  targetId: string;
  adAccountId: string;
  previousStatus: "ACTIVE" | "PAUSED";
  previousDailyBudgetMinor: number | null;
  requestedDailyBudgetMinor: number | null;
  /** Nome atual lido na Meta e nome pedido (renomear). */
  previousName?: string | null;
  requestedName?: string | null;
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
  const level = actionLevel(proposal.action);
  if (level !== entity.level) return no("Entidade incompatível.");
  if (entity.configuredStatus !== "ACTIVE" && entity.configuredStatus !== "PAUSED") return no("Entidade indisponível.");
  const pause = proposal.action.startsWith("pause_");
  const resume = proposal.action.startsWith("resume_");
  const rename = isRenameAction(proposal.action);
  if (pause && entity.configuredStatus !== "ACTIVE") return no("Entidade não está ativa.");
  if (resume && entity.configuredStatus !== "PAUSED") return no("Entidade não está pausada.");
  if (!pause && !resume && !rename && entity.configuredStatus !== "ACTIVE") return no("Alteração de orçamento exige entidade ativa.");
  if (rename) {
    const verdict = validateEntityName(proposal.newName, entity.name ?? null);
    if (!verdict.ok) return no(verdict.message);
    if (entity.name == null) return no("Nome atual não confirmado.");
  }

  // Anúncios e renomeações não têm orçamento: as checagens financeiras valem só para retomar campanha/conjunto e alterar orçamento.
  if (isBudgetSensitiveAction(proposal.action)) {
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
    previousName: entity.name ?? null, requestedName: rename ? proposal.newName! : null,
    rationale: proposal.rationale,
  } };
}
