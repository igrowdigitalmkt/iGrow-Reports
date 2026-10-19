import { z } from "zod";
import { ACTIONS } from "./policy";

/**
 * Contrato da SAIDA do modelo. Nao contem: IDs reais, organizacao, conta,
 * delegacao, permissao, aprovacao nem prazo. O modelo so aponta referencias de
 * fatos (c1, a2...) e justifica; o servidor resolve e decide o resto.
 */
const ref = z.string().regex(/^[ca][1-9]\d{0,2}$/);

export const recommendationSchema = z.object({
  action: z.enum([...ACTIONS, "no_action"]),
  targetRef: ref,
  rationale: z.string().trim().min(10).max(1200),
  /** Referencias de fatos que sustentam a decisao; devem existir no snapshot. */
  evidenceRefs: z.array(ref).min(1).max(5),
  confidence: z.enum(["low", "medium", "high"]),
  /** Somente para set_*_daily_budget: variacao relativa; o valor absoluto e calculado no servidor. */
  budgetChangePercent: z.number().int().min(-50).max(50).refine(v => v !== 0).optional(),
}).strict();

export const decisionOutputSchema = z.object({
  summary: z.string().trim().min(10).max(1500),
  recommendations: z.array(recommendationSchema).max(8),
}).strict();

export type Recommendation = z.infer<typeof recommendationSchema>;
export type DecisionOutput = z.infer<typeof decisionOutputSchema>;

/** JSON Schema entregue ao modelo (tool use); espelha o schema zod acima. */
export const DECISION_TOOL = {
  name: "submit_decision",
  description: "Entrega o diagnostico e as recomendacoes. Use somente referencias e numeros presentes nos fatos.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    required: ["summary", "recommendations"],
    properties: {
      summary: { type: "string", minLength: 10, maxLength: 1500 },
      recommendations: {
        type: "array", maxItems: 8,
        items: {
          type: "object", additionalProperties: false,
          required: ["action", "targetRef", "rationale", "evidenceRefs", "confidence"],
          properties: {
            action: { type: "string", enum: [...ACTIONS, "no_action"] },
            targetRef: { type: "string", pattern: "^[ca][1-9][0-9]{0,2}$" },
            rationale: { type: "string", minLength: 10, maxLength: 1200 },
            evidenceRefs: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", pattern: "^[ca][1-9][0-9]{0,2}$" } },
            confidence: { type: "string", enum: ["low", "medium", "high"] },
            budgetChangePercent: { type: "integer", minimum: -50, maximum: 50 },
          },
        },
      },
    },
  },
};
