import { z } from "zod";
import { MAX_ENTITY_NAME_LENGTH, validateEntityName } from "@/modules/agent-executor/policy";
import type { ManualLevel } from "./contracts";

/**
 * CONTRATOS TIPADOS (sem execução) de duplicação e criação na Meta. Nada aqui é ligado ao executor nem à interface: servem de base
 * para os próximos ciclos e já fixam as regras de segurança. Origem: Marketing API (consulta em 20/10/2026), ver
 * docs/DUPLICACAO_CRIACAO_META_PLANO.md. Regras fixas:
 * - a cópia SEMPRE nasce pausada (`status_option = PAUSED`); nunca ACTIVE nem INHERITED_FROM_SOURCE;
 * - cópia profunda respeita o limite documentado de filhos em chamada síncrona (3) e só 51 em assíncrona (ainda não suportada aqui);
 * - o destino (campanha ou conjunto pai) é explícito e validado; sem payload livre.
 */
export const DUPLICATE_SYNC_CHILD_LIMIT = 3;
export const DUPLICATE_ASYNC_CHILD_LIMIT = 51;
const metaId = z.string().regex(/^[1-9]\d*$/);

export const duplicateRequestSchema = z.object({
  level: z.enum(["campaign", "adset", "ad"]),
  sourceId: metaId,
  /** Pai de destino: obrigatório para conjunto (campanha) e anúncio (conjunto); inexistente para campanha. */
  targetParentId: metaId.optional(),
  statusOption: z.literal("PAUSED"),
  deepCopy: z.boolean().default(false),
  rename: z.object({ strategy: z.enum(["NO_RENAME", "ONLY_TOP_LEVEL_RENAME", "DEEP_RENAME"]).default("ONLY_TOP_LEVEL_RENAME"), prefix: z.string().max(50).optional(), suffix: z.string().max(50).optional() }).strict().default({ strategy: "ONLY_TOP_LEVEL_RENAME" }),
}).strict().superRefine((value, ctx) => {
  if (value.level === "campaign" && value.targetParentId !== undefined) ctx.addIssue({ code: "custom", path: ["targetParentId"], message: "Campanha não tem pai de destino." });
  if (value.level === "ad" && value.deepCopy) ctx.addIssue({ code: "custom", path: ["deepCopy"], message: "Anúncio não tem filhos." });
});
export type DuplicateRequest = z.infer<typeof duplicateRequestSchema>;

export type DuplicationPlan = { ok: true; mode: "sync" } | { ok: false; blockers: string[] };
/** Planeja a duplicação com o que se sabe da origem (filhos contados pela Groow a partir dos dados confirmados). Bloqueia, nunca degrada em silêncio. */
export function planDuplication(request: DuplicateRequest, source: { childCount: number }): DuplicationPlan {
  const blockers: string[] = [];
  if (request.level !== "campaign" && request.targetParentId === undefined) blockers.push("Informe a campanha ou o conjunto de destino.");
  if (request.deepCopy && source.childCount > DUPLICATE_SYNC_CHILD_LIMIT) {
    blockers.push(`A cópia profunda de mais de ${DUPLICATE_SYNC_CHILD_LIMIT} itens exige a cópia assíncrona (limite ${DUPLICATE_ASYNC_CHILD_LIMIT}), ainda não suportada: duplique em etapas.`);
  }
  return blockers.length ? { ok: false, blockers } : { ok: true, mode: "sync" };
}

/** Criação de CAMPANHA (primeiro caminho de criação planejado): estado inicial sempre pausado, sem orçamento implícito. */
export const CAMPAIGN_OBJECTIVES = ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_APP_PROMOTION"] as const;
export const SPECIAL_AD_CATEGORIES = ["NONE", "EMPLOYMENT", "HOUSING", "CREDIT", "ISSUES_ELECTIONS_POLITICS"] as const;
export const createCampaignSchema = z.object({
  name: z.string().max(MAX_ENTITY_NAME_LENGTH).refine(value => validateEntityName(value).ok, "Nome inválido."),
  objective: z.enum(CAMPAIGN_OBJECTIVES),
  /** Obrigatório na criação (a Meta exige a declaração; "NONE" quando não se aplica). Não editável depois. */
  specialAdCategories: z.array(z.enum(SPECIAL_AD_CATEGORIES)).min(1).max(4),
  buyingType: z.literal("AUCTION"),
  status: z.literal("PAUSED"),
  dailyBudgetMinor: z.number().int().positive().max(1_000_000_000_000).optional(),
}).strict();
export type CreateCampaignRequest = z.infer<typeof createCampaignSchema>;

export const LEVEL_NOT_IMPLEMENTED: Record<ManualLevel, string[]> = {
  campaign: ["duplicar campanha", "criar campanha"], adset: ["duplicar conjunto", "criar conjunto"], ad: ["duplicar anúncio", "criar anúncio"],
};
