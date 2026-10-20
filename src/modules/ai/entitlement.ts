/** Resposta de agency_ai_entitlement; formato inesperado vale como indisponível (nega por segurança). */
export function parseAiEntitlement(value: unknown): { allowed: boolean; budgetUsd: number | null; restricted: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { allowed, budget_usd: budget, restricted } = value as { allowed?: unknown; budget_usd?: unknown; restricted?: unknown };
  if (typeof allowed !== "boolean") return null;
  if (budget !== null && budget !== undefined && (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0)) return null;
  return { allowed, budgetUsd: typeof budget === "number" ? budget : null, restricted: restricted === true };
}
