import { createHash } from "node:crypto";
import { entityDeliveryActive, type AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";

/**
 * Fatos do motor de decisao. PUROS e deterministicos: o modelo recebe apenas
 * referencias opacas (c1, a2...) e metricas ja calculadas. IDs da Meta, conta e
 * organizacao ficam no mapa `targets`, que nunca e enviado ao modelo.
 */
export type FactTarget = {
  ref: string;
  level: "campaign" | "adset";
  metaId: string;
  adAccountId: string;
  status: "ACTIVE" | "PAUSED";
  /** Orcamento diario atual em unidade menor, quando conhecido; nao vem de metricas de gasto. */
  dailyBudgetMinor: number | null;
  /** Metricas confirmadas desta entidade: fonte dos marcadores {ref.metrica} citados pela IA. */
  metrics: Readonly<Record<string, number>>;
};

export type DecisionFacts = {
  /** Texto entregue ao modelo; todo numero citado por ele precisa existir aqui. */
  factsText: string;
  factsHash: string;
  collectedAt: string;
  currency: string;
  targets: ReadonlyMap<string, FactTarget>;
};

export type FactsInput = {
  entities: AnalyticsEntity[];
  previousEntities?: AnalyticsEntity[];
  currency: string;
  periodFrom: string;
  periodTo: string;
  /** Instante comprovado da coleta; definido pelo servidor. */
  collectedAt: string;
  /** Objetivos declarados no perfil do cliente (texto livre curto, ja sanitizado pelo servidor). */
  goals?: string[];
  /** Orcamentos diarios confirmados por entidade (chave `${accountId}:${id}`). */
  budgetsMinor?: ReadonlyMap<string, number>;
};

const MAX_ENTITIES = 40;

function cleanValues(values: AnalyticsEntity["values"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.round(value * 10_000) / 10_000;
  }
  return out;
}

export function buildDecisionFacts(input: FactsInput): DecisionFacts {
  const previous = new Map((input.previousEntities ?? []).map(e => [`${e.accountId}:${e.level}:${e.id}`, e]));
  // Campanhas e conjuntos, priorizando maior gasto; limita o contexto enviado.
  const eligible = input.entities.filter(e => e.level === "campaign" || e.level === "adset")
    .sort((a, b) => (b.values.spend ?? 0) - (a.values.spend ?? 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_ENTITIES);

  const targets = new Map<string, FactTarget>();
  const rows = eligible.map((entity, index) => {
    const ref = `${entity.level === "campaign" ? "c" : "a"}${index + 1}`;
    const status = entityDeliveryActive(entity) ? "ACTIVE" : "PAUSED";
    const budget = input.budgetsMinor?.get(`${entity.accountId}:${entity.id}`) ?? null;
    targets.set(ref, {
      ref, level: entity.level as "campaign" | "adset", metaId: entity.id,
      adAccountId: entity.accountId, status, dailyBudgetMinor: budget, metrics: cleanValues(entity.values),
    });
    const before = previous.get(`${entity.accountId}:${entity.level}:${entity.id}`);
    return {
      ref, level: entity.level, name: entity.name.slice(0, 80), status,
      metrics: cleanValues(entity.values),
      ...(before ? { previousMetrics: cleanValues(before.values) } : {}),
    };
  });

  const availableMetrics = [...new Set(rows.flatMap(row => Object.keys(row.metrics)))].sort();
  const facts = {
    period: { from: input.periodFrom, to: input.periodTo }, currency: input.currency,
    // Chaves validas para os marcadores {ref.metrica}; qualquer outra e "indisponivel".
    availableMetrics,
    goals: (input.goals ?? []).slice(0, 8).map(goal => goal.slice(0, 200)), entities: rows,
  };
  const factsText = JSON.stringify(facts);
  return {
    factsText, collectedAt: input.collectedAt, currency: input.currency, targets,
    factsHash: createHash("sha256").update(factsText).digest("hex"),
  };
}
