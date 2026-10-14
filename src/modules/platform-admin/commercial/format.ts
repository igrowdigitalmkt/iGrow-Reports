import { z } from "zod";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

export const formatBrl = (cents: number | null | undefined) => (cents == null ? "Não oferecido" : brl.format(cents / 100));
export const formatUsdFromCents = (cents: number) => usd.format(cents / 100);

/** "49,90" ou "49.90" → 4990. Vazio → null (ciclo não oferecido). Valor inválido → undefined. */
export function parseMoneyToCents(value: FormDataEntryValue | null): number | null | undefined {
  const text = String(value ?? "").trim().replace(/^R\$\s*|^US\$\s*/i, "");
  if (text === "") return null;
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(text)) return undefined;
  return Math.round(Number(text.replace(",", ".")) * 100);
}

export const centsToInput = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2).replace(".", ","));

/** Limites digitados em dólar (o catálogo guarda centavos de dólar). */
export const USD_LIMIT_KEYS = new Set(["ai_budget_usd_cents"]);

export const planVersionSchema = z.object({
  id: z.string(), version: z.number(), status: z.enum(["draft", "published", "retired"]), trial_days: z.number(),
  price_monthly_cents: z.number().nullable(), price_yearly_cents: z.number().nullable(), published_at: z.string().nullable(),
  assigned_orgs: z.number(),
  entitlements: z.array(z.object({ key: z.string(), enabled: z.boolean(), limit: z.number().nullable(), unlimited: z.boolean() })),
});
export const planDetailSchema = z.object({
  plan: z.object({ id: z.string(), key: z.string(), name: z.string(), description: z.string(), visibility: z.enum(["public", "private"]),
    sellable: z.boolean(), recommended: z.boolean(), sort_order: z.number(), current_version_id: z.string().nullable() }),
  versions: z.array(planVersionSchema),
});
export type PlanVersion = z.infer<typeof planVersionSchema>;
export type PlanDetail = z.infer<typeof planDetailSchema>;

export const planKeySchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,39}$/, "O identificador usa letras minúsculas, números, - ou _ (2 a 40 caracteres, começando por letra).");

export const SOURCE_LABELS: Record<string, string> = {
  global: "Desativado globalmente", unmanaged: "Sem plano atribuído (sem restrição)", override: "Concessão", plan: "Plano", plan_not_included: "Não incluso no plano",
};

/** Texto de um direito já resolvido ("Incluso", "Ilimitado", "até 10"). */
export function describeEntitlement(row: { kind: string; enabled: boolean; limit_value: number | null; unlimited: boolean; key: string }) {
  if (row.kind === "feature") return row.enabled ? "Incluso" : "Não incluso";
  if (row.unlimited) return "Ilimitado";
  if (row.limit_value == null || row.limit_value === 0) return "Não incluso";
  return `até ${USD_LIMIT_KEYS.has(row.key) ? formatUsdFromCents(row.limit_value) : row.limit_value}`;
}
