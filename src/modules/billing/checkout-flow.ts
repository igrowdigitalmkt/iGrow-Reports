import "server-only";
import { z } from "zod";
import { billingDataSchema, type BillingData } from "./billing-data";
import { checkoutMessage, startCheckout, type CheckoutUrls } from "./contracting";
import { callRpc } from "./db";
import type { BillingDeps } from "./event-processor";
import { parseOffers, priceOf } from "./offers";

/** O navegador só é enviado para o checkout hospedado do Asaas DO AMBIENTE em uso (sandbox ou produção), nunca para um endereço vindo de outro lugar. */
const CHECKOUT_HOSTS: Record<"sandbox" | "production", string[]> = { sandbox: ["sandbox.asaas.com"], production: ["www.asaas.com", "asaas.com"] };
export function isTrustedCheckoutUrl(raw: string | null | undefined, environment: "sandbox" | "production" = "sandbox") {
  try {
    const url = new URL(String(raw));
    return url.protocol === "https:" && CHECKOUT_HOSTS[environment].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

/** Retorno do checkout: só informa e dá uma dica de texto; a liberação do plano nunca depende destas páginas. */
export function buildReturnUrls(origin: string | null | undefined): CheckoutUrls | null {
  try {
    const base = new URL(String(origin));
    if (!["https:", "http:"].includes(base.protocol)) return null;
    const url = (hint: "ok" | "cancelado" | "expirado") => `${base.origin}/dashboard/assinatura/retorno?e=${hint}`;
    return { successUrl: url("ok"), cancelUrl: url("cancelado"), expiredUrl: url("expirado") };
  } catch { return null; }
}

// Só estes campos são lidos do navegador. Qualquer preço, valor ou plano em outro formato é descartado.
const inputSchema = z.object({
  planVersionId: z.string().uuid(),
  cycle: z.enum(["monthly", "yearly"]),
  requestKey: z.string().regex(/^[A-Za-z0-9-]{8,80}$/),
  billing: z.unknown().optional(),
});

export type CheckoutStartResult =
  | { status: "redirect"; url: string; reused: boolean }
  | { status: "pending"; message: string; retryAfter: string | null }
  | { status: "needs_billing_data"; message: string }
  | { status: "invalid_data"; message: string; field: string | null }
  | { status: "error"; message: string };

export type CheckoutContext = {
  agencyId: string; userId: string; role: string; origin: string | null | undefined;
  /** Ofertas lidas com a sessão DO USUÁRIO (o banco confere o papel); o preço usado é o do banco, não o do navegador. */
  listOffers: () => Promise<unknown>;
};

export async function runCheckoutStart(deps: BillingDeps, context: CheckoutContext, rawInput: unknown): Promise<CheckoutStartResult> {
  if (context.role !== "owner") return { status: "error", message: "Somente o proprietário da organização pode contratar." };
  const input = inputSchema.safeParse(rawInput);
  if (!input.success) return { status: "error", message: "Solicitação inválida. Recarregue a página e tente de novo." };
  const urls = buildReturnUrls(context.origin);
  if (!urls) return { status: "error", message: "A contratação não está disponível neste ambiente." };

  let offers;
  try { offers = parseOffers(await context.listOffers()); } catch { return { status: "error", message: "Não foi possível carregar os planos agora. Tente novamente em instantes." }; }
  const offer = offers.find((item) => item.plan_version_id === input.data.planVersionId);
  if (!offer || !priceOf(offer, input.data.cycle)) return { status: "error", message: "Este plano não está disponível para contratação." };

  let billing: BillingData | null = null;
  let hasCustomer: string | null;
  try {
    hasCustomer = await callRpc<string | null>(deps.db, "billing_get_customer", { p_agency_id: context.agencyId, p_environment: deps.environment });
  } catch { return { status: "error", message: "Não foi possível iniciar a contratação agora. Nada foi cobrado. Tente novamente em instantes." }; }
  if (!hasCustomer) {
    if (input.data.billing === undefined || input.data.billing === null) return { status: "needs_billing_data", message: "Informe os dados de cobrança para continuar." };
    const parsed = billingDataSchema.safeParse(input.data.billing);
    if (!parsed.success) return { status: "invalid_data", message: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0] ?? "") || null };
    billing = parsed.data;
  }

  const result = await startCheckout(deps, {
    agencyId: context.agencyId, userId: context.userId, planVersionId: offer.plan_version_id, cycle: input.data.cycle, requestKey: input.data.requestKey,
    planName: offer.name, urls, loadCustomerData: async () => { if (!billing) throw new Error("dados de cobrança ausentes"); return billing; },
  });
  if (result.status === "ready") {
    if (!isTrustedCheckoutUrl(result.checkoutUrl, deps.environment)) {
      console.error("billing-checkout-url-untrusted");
      return { status: "error", message: "Não foi possível abrir o pagamento com segurança. Nada foi cobrado. Tente novamente em instantes." };
    }
    return { status: "redirect", url: result.checkoutUrl, reused: result.reused };
  }
  if (result.status === "in_progress") return { status: "pending", message: checkoutMessage(result), retryAfter: result.retryAfter };
  return { status: "error", message: checkoutMessage(result) };
}
