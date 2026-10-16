import "server-only";
import { AsaasError, type AsaasApi, type AsaasPayment, type AsaasSubscription } from "./asaas-client";
import { BillingDbError, callRpc, type BillingDb } from "./db";

export type ClaimedEvent = {
  id: number; environment: string; asaas_event_id: string; event_type: string; resource_type: string; resource_id: string | null;
  payload: Record<string, unknown>; attempts: number;
};
export type EventOutcome = { outcome: "processed" | "ignored" | "needs_review" | "retry"; detail?: string };
export type BillingDeps = { db: BillingDb; asaas: AsaasApi; environment: "sandbox" | "production"; now?: () => Date };

const IGNORED_PAYMENT_EVENTS = new Set(["PAYMENT_BANK_SLIP_VIEWED", "PAYMENT_CHECKOUT_VIEWED"]);
// Resultados do banco que pedem decisão humana (nunca ativam nem bloqueiam sozinhos).
export const REVIEW_OUTCOMES = new Set(["mismatch", "unattributed", "duplicate_subscription", "no_intent", "needs_review", "payment_for_canceled", "intent_closed", "ambiguous_intent", "unlinked_candidate"]);

export function paymentSnapshot(payment: AsaasPayment, observedAt: Date) {
  return {
    id: payment.id, subscription: payment.subscription ?? null, customer: payment.customer, value: payment.value, dueDate: payment.dueDate,
    status: payment.deleted ? "OTHER" : payment.status, billingType: payment.billingType, confirmedDate: payment.confirmedDate ?? null,
    paymentDate: payment.paymentDate ?? null, invoiceUrl: payment.invoiceUrl ?? null, observedAt: observedAt.toISOString(),
  };
}

export function subscriptionSnapshot(subscription: AsaasSubscription | { id: string; deleted: true }) {
  if (!("customer" in subscription)) return { id: subscription.id, deleted: true };
  return { id: subscription.id, customer: subscription.customer, value: subscription.value, cycle: subscription.cycle, status: subscription.status, billingType: subscription.billingType, deleted: subscription.deleted ?? false,
    checkoutSession: subscription.checkoutSession ?? null, externalReference: subscription.externalReference ?? null };
}

export async function applySubscription(deps: BillingDeps, subscription: AsaasSubscription | { id: string; deleted: true }, eventId: number | null) {
  return callRpc<string>(deps.db, "billing_apply_subscription", { p_environment: deps.environment, p_snapshot: subscriptionSnapshot(subscription), p_event_id: eventId });
}

/** Aplica um pagamento LIDO NA API (nunca o corpo do webhook). Se a assinatura ainda é desconhecida, lê e registra a assinatura primeiro. */
export async function applyPayment(deps: BillingDeps, payment: AsaasPayment, observedAt: Date, eventId: number | null, signal: string | null) {
  const args = () => ({ p_environment: deps.environment, p_snapshot: paymentSnapshot(payment, observedAt), p_event_id: eventId, p_signal: signal });
  let outcome = await callRpc<string>(deps.db, "billing_apply_payment", args());
  if (outcome === "unknown_subscription" && payment.subscription) {
    const subscription = await deps.asaas.getSubscription(payment.subscription);
    await applySubscription(deps, subscription, eventId);
    outcome = await callRpc<string>(deps.db, "billing_apply_payment", args());
  }
  return outcome;
}

/**
 * Aplica uma assinatura LIDA NA API do Asaas e, se ela foi registrada (ou já era conhecida), lê e aplica suas cobranças. É o caminho único
 * usado pelo evento de checkout pago, pela reconciliação e pela conferência antes de uma nova contratação.
 */
export async function applySubscriptionAndPayments(deps: BillingDeps, subscription: AsaasSubscription, eventId: number | null): Promise<string[]> {
  const outcomes: string[] = [];
  const outcome = await applySubscription(deps, subscription, eventId);
  outcomes.push(outcome);
  if (outcome === "created" || outcome === "noop") {
    const observedAt = (deps.now ?? (() => new Date()))();
    const payments = await deps.asaas.listSubscriptionPayments(subscription.id, 12);
    for (const payment of [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) outcomes.push(await applyPayment(deps, payment, observedAt, eventId, null));
  }
  return outcomes;
}

function fromOutcome(outcome: string, attempts: number): EventOutcome {
  if (REVIEW_OUTCOMES.has(outcome)) return { outcome: "needs_review", detail: `Resultado: ${outcome}.` };
  if (outcome === "unknown_subscription") {
    // A assinatura pode chegar por outro evento: tenta de novo algumas vezes antes de pedir revisão.
    return attempts >= 4 ? { outcome: "needs_review", detail: "Assinatura do pagamento não encontrada." } : { outcome: "retry", detail: "Assinatura ainda desconhecida." };
  }
  return { outcome: "processed", detail: `Resultado: ${outcome}.` };
}

function fromError(error: unknown): EventOutcome {
  if (error instanceof AsaasError) {
    if (error.status === 404) return { outcome: "needs_review", detail: "Recurso não encontrado no Asaas." };
    if (error.retryable || error.status === 401 || error.status === 403) return { outcome: "retry", detail: `Asaas indisponível ou não autorizado (${error.status ?? error.code ?? "rede"}).` };
    return { outcome: "needs_review", detail: `Asaas recusou a consulta (${error.status ?? error.code}).` };
  }
  if (error instanceof BillingDbError) return { outcome: "retry", detail: `Falha ao gravar (${error.rpcName}${error.code ? ` ${error.code}` : ""}).` };
  return { outcome: "retry", detail: "Erro inesperado no processamento." };
}

type CheckoutLookup = { intent_id: string; agency_id: string; status: string; asaas_customer_id: string | null } | null;

/**
 * Eventos do checkout hospedado. NENHUM deles ativa nada por si só:
 *  - CHECKOUT_PAID: só dispara a verificação. Lê na API do Asaas as assinaturas do cliente DESTA intenção e as aplica pelo caminho
 *    verificado (cliente nosso, valor, ciclo, cartão e checkout conferidos); depois lê e aplica as cobranças.
 *  - CHECKOUT_CANCELED / CHECKOUT_EXPIRED: fecham só a intenção em aberto desse checkout (nunca uma já concluída).
 *  - CHECKOUT_CREATED e demais: informativos.
 */
async function processCheckoutEvent(deps: BillingDeps, event: ClaimedEvent): Promise<EventOutcome> {
  const checkoutId = event.resource_id!;
  if (event.event_type === "CHECKOUT_CANCELED" || event.event_type === "CHECKOUT_EXPIRED") {
    const outcome = await callRpc<string>(deps.db, "billing_close_intent", { p_environment: deps.environment, p_checkout_id: checkoutId, p_status: event.event_type === "CHECKOUT_CANCELED" ? "canceled" : "expired" });
    if (outcome === "unknown_checkout") return event.attempts >= 4 ? { outcome: "needs_review", detail: "Checkout sem contratação correspondente." } : { outcome: "retry", detail: "Checkout ainda não associado a uma contratação." };
    return { outcome: "processed", detail: `Resultado: ${outcome}.` };
  }
  if (event.event_type !== "CHECKOUT_PAID") return { outcome: "ignored", detail: "Evento de checkout informativo." };

  const found = await callRpc<CheckoutLookup>(deps.db, "billing_intent_by_checkout", { p_environment: deps.environment, p_checkout_id: checkoutId });
  if (!found) return event.attempts >= 4 ? { outcome: "needs_review", detail: "Checkout pago sem contratação correspondente." } : { outcome: "retry", detail: "Checkout ainda não associado a uma contratação." };
  if (!found.asaas_customer_id) return { outcome: "needs_review", detail: "Contratação sem cliente financeiro." };

  const subscriptions = (await deps.asaas.listCustomerSubscriptions(found.asaas_customer_id, 20))
    .filter((subscription) => !subscription.deleted && !["INACTIVE", "EXPIRED"].includes(subscription.status.toUpperCase()));
  if (subscriptions.length === 0) return event.attempts >= 4 ? { outcome: "needs_review", detail: "Checkout pago, mas nenhuma assinatura ativa foi encontrada." } : { outcome: "retry", detail: "Assinatura ainda não disponível." };

  const outcomes: string[] = [];
  for (const subscription of subscriptions) outcomes.push(...await applySubscriptionAndPayments(deps, subscription, event.id));
  const review = outcomes.find((outcome) => REVIEW_OUTCOMES.has(outcome));
  return review ? { outcome: "needs_review", detail: `Resultado: ${review}.` } : { outcome: "processed", detail: `Resultados: ${[...new Set(outcomes)].join(", ")}.` };
}

export async function processClaimedEvent(deps: BillingDeps, event: ClaimedEvent): Promise<EventOutcome> {
  try {
    if (event.environment !== deps.environment) return { outcome: "needs_review", detail: "Ambiente do evento não é o configurado." };
    if (event.resource_type === "payment" && event.resource_id) {
      if (IGNORED_PAYMENT_EVENTS.has(event.event_type)) return { outcome: "ignored", detail: "Evento informativo." };
      const observedAt = (deps.now ?? (() => new Date()))();
      let payment: AsaasPayment;
      try {
        payment = await deps.asaas.getPayment(event.resource_id);
      } catch (error) {
        // Cobrança removida no Asaas (ex.: ao cancelar a assinatura): não há mais o que ler, e isso não é um problema.
        if (error instanceof AsaasError && error.status === 404 && event.event_type === "PAYMENT_DELETED") return { outcome: "ignored", detail: "Cobrança removida no Asaas." };
        throw error;
      }
      if (payment.id !== event.resource_id) return { outcome: "needs_review", detail: "Pagamento retornado difere do evento." };
      const signal = event.event_type === "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED" ? "capture_refused" : null;
      return fromOutcome(await applyPayment(deps, payment, observedAt, event.id, signal), event.attempts);
    }
    if (event.resource_type === "checkout" && event.resource_id) return await processCheckoutEvent(deps, event);
    if (event.resource_type === "subscription" && event.resource_id) {
      let subscription: AsaasSubscription | { id: string; deleted: true };
      try {
        subscription = await deps.asaas.getSubscription(event.resource_id);
      } catch (error) {
        // Remoção confirmada pelo próprio evento: o objeto pode não existir mais para consulta.
        if (error instanceof AsaasError && error.status === 404 && event.event_type === "SUBSCRIPTION_DELETED") subscription = { id: event.resource_id, deleted: true };
        else throw error;
      }
      return fromOutcome(await applySubscription(deps, subscription, event.id), event.attempts);
    }
    return { outcome: "ignored", detail: "Evento sem efeito financeiro direto (a confirmação vem pelos eventos de cobrança e assinatura)." };
  } catch (error) {
    return fromError(error);
  }
}

export type DrainSummary = { claimed: number; processed: number; ignored: number; needs_review: number; retry: number; deferred: number };

/** Reserva eventos gravados, processa cada um e registra o resultado. Recuperável: o que falhar volta a ser tentado depois. */
export async function drainBillingEvents(deps: BillingDeps, options: { limit?: number; eventId?: number; deadlineMs?: number } = {}): Promise<DrainSummary> {
  const claimed = await callRpc<ClaimedEvent[]>(deps.db, "billing_claim_events", { p_limit: options.limit ?? 10, p_lease_seconds: 120, p_event_id: options.eventId ?? null });
  const summary: DrainSummary = { claimed: claimed.length, processed: 0, ignored: 0, needs_review: 0, retry: 0, deferred: 0 };
  for (const event of claimed) {
    // Fim do tempo disponível: o restante fica reservado só até a reserva vencer (cerca de 2 min) e então é retomado.
    if (options.deadlineMs && Date.now() > options.deadlineMs) { summary.deferred += 1; continue; }
    const result = await processClaimedEvent(deps, event);
    summary[result.outcome] += 1;
    try {
      await callRpc(deps.db, "billing_finish_event", { p_id: event.id, p_outcome: result.outcome, p_detail: result.detail ?? null, p_retry_seconds: 60 });
    } catch {
      // Sem registrar o resultado, a reserva vence sozinha e outro processo retoma o evento.
    }
  }
  return summary;
}
