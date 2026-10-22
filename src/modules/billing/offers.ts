import { z } from "zod";
import { formatCredits, usdToCredits } from "@/modules/ai/credits";

// Planos contratáveis: vêm do banco (catálogo da etapa 2.1). Os preços aqui são só para EXIBIÇÃO; o valor cobrado é sempre
// recalculado no servidor a partir da versão publicada (billing_create_intent).

const entitlementSchema = z.object({
  key: z.string(), label: z.string(), kind: z.enum(["feature", "limit"]), unit: z.string().nullish(),
  enabled: z.boolean(), limit: z.number().int().nullish(), unlimited: z.boolean(),
});
const offerSchema = z.object({
  plan_id: z.string(), plan_version_id: z.string().uuid(), version: z.number().int(), name: z.string(), description: z.string().nullish(),
  recommended: z.boolean(), price_monthly_cents: z.number().int().nullable(), price_yearly_cents: z.number().int().nullable(),
  entitlements: z.array(entitlementSchema),
});
export type Offer = z.infer<typeof offerSchema>;
export type Cycle = "monthly" | "yearly";

export function parseOffers(value: unknown): Offer[] {
  const parsed = z.array(offerSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export const formatBRL = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function priceOf(offer: Offer, cycle: Cycle) {
  const cents = cycle === "monthly" ? offer.price_monthly_cents : offer.price_yearly_cents;
  return cents && cents > 0 ? cents : null;
}

/** Economia do plano anual em relação a 12 mensalidades (null quando não há os dois preços ou não há economia). */
export function yearlySavings(offer: Offer) {
  if (!offer.price_monthly_cents || !offer.price_yearly_cents) return null;
  const saving = offer.price_monthly_cents * 12 - offer.price_yearly_cents;
  return saving > 0 ? saving : null;
}

export function describeEntitlement(item: Offer["entitlements"][number]): string | null {
  if (item.kind === "feature") return item.enabled ? item.label : null;
  if (item.unlimited) return `${item.label}: ilimitado`;
  if (!item.limit || item.limit <= 0) return null;
  if (item.key === "ai_budget_usd_cents") return `${item.label}: até ${formatCredits(usdToCredits(item.limit / 100))} créditos`;
  return `${item.label}: até ${item.limit}`;
}

export const cycleLabels: Record<Cycle, string> = { monthly: "Mensal", yearly: "Anual" };
export const cycleDescriptions: Record<Cycle, string> = { monthly: "cobrado todo mês", yearly: "cobrado uma vez por ano, valor integral" };
