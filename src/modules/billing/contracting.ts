import "server-only";
import { AsaasError, type AsaasCustomerInput } from "./asaas-client";
import { BillingDbError, callRpc } from "./db";
import type { BillingDeps } from "./event-processor";
import { verifyBeforeContracting } from "./reconcile";

export type CustomerData = Omit<AsaasCustomerInput, "externalReference">;
export type CheckoutUrls = { successUrl: string; cancelUrl: string; expiredUrl: string };
export type StartCheckoutInput = {
  agencyId: string; userId: string; planVersionId: string; cycle: "monthly" | "yearly"; requestKey: string; planName: string;
  urls: CheckoutUrls;
  /** Dados do cadastro no Asaas: só buscados se a organização ainda não tem cliente financeiro. */
  loadCustomerData: () => Promise<CustomerData>;
};
export type StartCheckoutResult =
  | { status: "ready"; intentId: string; checkoutUrl: string; reused: boolean }
  // creating: preparando · verifying: o Asaas pode ter criado o checkout; estamos verificando e uma nova tentativa só é possível
  // depois de retryAfter (prazo do checkout enviado) · no_link: checkout criado sem endereço (a confirmar no Sandbox).
  | { status: "in_progress"; intentId: string; reason: "creating" | "verifying" | "no_link"; retryAfter: string | null }
  | { status: "rejected"; reason: "forbidden" | "already_subscribed" | "invalid" | "unavailable" };

type Intent = {
  intent_id: string; status: string; reused: boolean; asaas_checkout_id: string | null; checkout_url: string | null; amount_cents: number;
  checkout_minutes: number; expires_at: string | null;
};

const brasiliaDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);

/** Texto para o cliente em cada situação (sem termos técnicos). */
export function checkoutMessage(result: StartCheckoutResult, timeZone = "America/Sao_Paulo"): string {
  if (result.status === "ready") return "Redirecionando para o pagamento seguro.";
  if (result.status === "in_progress") {
    if (result.reason === "verifying") {
      const at = result.retryAfter ? new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone }).format(new Date(result.retryAfter)) : null;
      return `Estamos verificando sua contratação. Não há nova cobrança enquanto isso — e não pague de novo${at ? `; se não for concluída, você poderá tentar de novo depois das ${at}` : ""}.`;
    }
    return result.reason === "no_link" ? "Sua contratação foi iniciada. Estamos preparando o pagamento; tente novamente em instantes." : "Estamos preparando o pagamento. Aguarde alguns instantes.";
  }
  if (result.reason === "forbidden") return "Somente o proprietário da organização pode contratar.";
  if (result.reason === "already_subscribed") return "Esta organização já possui uma assinatura. Gerencie-a em Assinatura.";
  if (result.reason === "invalid") return "Este plano não está disponível para contratação.";
  return "Não foi possível iniciar a contratação agora. Nada foi cobrado. Tente novamente em instantes.";
}

/**
 * Contratação. Regras de segurança financeira:
 *  1. a intenção é gravada ANTES de qualquer envio ao Asaas; o valor vem do banco (versão do plano);
 *  2. o envio é registrado ('dispatching') ANTES da chamada: se não der para registrar, nada é enviado;
 *  3. o Asaas é chamado no máximo UMA vez por intenção; reenvio, segunda aba ou timeout reaproveitam a intenção;
 *  4. sem resposta, a intenção fica protegida só até o prazo do checkout (que nós mesmos enviamos) e a reconciliação consulta
 *     o Asaas para ver se a assinatura já existe.
 */
export async function startCheckout(deps: BillingDeps, input: StartCheckoutInput): Promise<StartCheckoutResult> {
  const createIntent = () => callRpc<Intent>(deps.db, "billing_create_intent", {
    p_agency_id: input.agencyId, p_user_id: input.userId, p_plan_version_id: input.planVersionId, p_cycle: input.cycle, p_request_key: input.requestKey, p_environment: deps.environment,
  });
  let intent: Intent;
  try {
    try {
      intent = await createIntent();
    } catch (error) {
      // 55000: uma contratação anterior expirou, mas pode ter sido paga. Confere no Asaas antes de abrir outra (nunca duas cobranças).
      if (!(error instanceof BillingDbError && error.code === "55000")) throw error;
      if ((await verifyBeforeContracting(deps, input.agencyId)) !== "clear") return { status: "in_progress", intentId: "", reason: "verifying", retryAfter: null };
      intent = await createIntent();
    }
  } catch (error) {
    if (error instanceof BillingDbError) {
      if (error.code === "42501") return { status: "rejected", reason: "forbidden" };
      if (error.code === "23505") return { status: "rejected", reason: "already_subscribed" };
      if (error.code === "22023") return { status: "rejected", reason: "invalid" };
      if (error.code === "55000") return { status: "in_progress", intentId: "", reason: "verifying", retryAfter: null };
    }
    return { status: "rejected", reason: "unavailable" };
  }

  if (intent.reused) {
    if (intent.status === "awaiting_payment" && intent.checkout_url) return { status: "ready", intentId: intent.intent_id, checkoutUrl: intent.checkout_url, reused: true };
    const verifying = intent.status === "unknown" || intent.status === "dispatching";
    return { status: "in_progress", intentId: intent.intent_id, reason: verifying ? "verifying" : "creating", retryAfter: verifying ? intent.expires_at : null };
  }

  const mark = (status: string, extra: Record<string, unknown> = {}) =>
    callRpc<{ expires_at: string | null }>(deps.db, "billing_mark_intent", { p_intent_id: intent.intent_id, p_status: status, p_checkout_id: null, p_checkout_url: null, p_error: null, ...extra });

  // 1. Cliente financeiro (não gera cobrança; em falha, a tentativa pode ser refeita).
  let customerId: string | null;
  try {
    customerId = await callRpc<string | null>(deps.db, "billing_get_customer", { p_agency_id: input.agencyId, p_environment: deps.environment });
    if (!customerId) {
      const data = await input.loadCustomerData();
      const created = await deps.asaas.createCustomer({ ...data, externalReference: input.agencyId });
      customerId = await callRpc<string>(deps.db, "billing_set_customer", { p_agency_id: input.agencyId, p_environment: deps.environment, p_asaas_customer_id: created.id });
    }
  } catch (error) {
    await mark("failed", { p_error: error instanceof AsaasError ? `Cliente: Asaas ${error.status ?? error.code}` : "Cliente financeiro indisponível" }).catch(() => undefined);
    return { status: "rejected", reason: "unavailable" };
  }

  // 2. Registra o envio ANTES de enviar. Se não for possível registrar, nada é enviado (a intenção é liberada em minutos).
  let dispatched: { expires_at: string | null };
  try {
    dispatched = await mark("dispatching");
  } catch {
    return { status: "rejected", reason: "unavailable" };
  }

  // 3. Checkout hospedado (cartão): chamada única.
  let checkout: { id: string; link: string | null };
  try {
    checkout = await deps.asaas.createCheckout({
      customerId, itemName: input.planName, valueCents: intent.amount_cents, cycle: input.cycle, nextDueDate: brasiliaDate((deps.now ?? (() => new Date()))()),
      minutesToExpire: intent.checkout_minutes, externalReference: intent.intent_id, ...input.urls,
    });
  } catch (error) {
    if (error instanceof AsaasError && !error.ambiguous) {
      await mark("failed", { p_error: `Checkout recusado (${error.status ?? error.code})` }).catch(() => undefined);
      return { status: "rejected", reason: "unavailable" };
    }
    // Resultado desconhecido: o checkout pode existir. Nunca se cria um segundo; o cliente vê "verificando".
    await mark("unknown", { p_error: "Sem resposta do Asaas ao criar o checkout" }).catch(() => undefined);
    return { status: "in_progress", intentId: intent.intent_id, reason: "verifying", retryAfter: dispatched.expires_at };
  }

  try {
    await mark("awaiting_payment", { p_checkout_id: checkout.id, p_checkout_url: checkout.link });
  } catch {
    // Gravação falhou depois de o Asaas responder: a intenção segue protegida até o prazo do checkout e a reconciliação resolve.
    return { status: "in_progress", intentId: intent.intent_id, reason: "verifying", retryAfter: dispatched.expires_at };
  }
  return checkout.link
    ? { status: "ready", intentId: intent.intent_id, checkoutUrl: checkout.link, reused: false }
    : { status: "in_progress", intentId: intent.intent_id, reason: "no_link", retryAfter: dispatched.expires_at };
}

export type CancelResult = { status: "requested"; effectiveAt: string | null; remoteCancel: "done" | "pending" } | { status: "rejected"; reason: "forbidden" | "none" | "unavailable" };

/** Cancelamento: o período já pago é preservado no Groow Ads; o Asaas é avisado depois do registro (e repetido pela reconciliação se falhar). */
export async function cancelSubscriptionRequest(deps: BillingDeps, input: { agencyId: string; userId: string }): Promise<CancelResult> {
  let requested: { subscription_id: string; asaas_subscription_id: string; effective_at: string | null; environment: string; remote_cancel_pending?: boolean };
  try {
    requested = await callRpc(deps.db, "billing_request_cancel", { p_agency_id: input.agencyId, p_user_id: input.userId });
  } catch (error) {
    if (error instanceof BillingDbError && error.code === "42501") return { status: "rejected", reason: "forbidden" };
    if (error instanceof BillingDbError && error.code === "22023") return { status: "rejected", reason: "none" };
    return { status: "rejected", reason: "unavailable" };
  }
  // Pedido repetido (clique duplo, nova aba): o aviso ao Asaas já foi confirmado antes; nada a fazer e nenhuma chamada extra.
  if (requested.remote_cancel_pending === false) return { status: "requested", effectiveAt: requested.effective_at, remoteCancel: "done" };
  if (requested.environment !== deps.environment) return { status: "requested", effectiveAt: requested.effective_at, remoteCancel: "pending" };
  try {
    try { await deps.asaas.cancelSubscription(requested.asaas_subscription_id); }
    catch (error) { if (!(error instanceof AsaasError && error.status === 404)) throw error; }
    await callRpc(deps.db, "billing_confirm_remote_cancel", { p_subscription_id: requested.subscription_id });
    return { status: "requested", effectiveAt: requested.effective_at, remoteCancel: "done" };
  } catch {
    return { status: "requested", effectiveAt: requested.effective_at, remoteCancel: "pending" };
  }
}
