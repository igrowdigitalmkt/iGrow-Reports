import "server-only";
import { AsaasError, type AsaasApi, type AsaasPayment, type AsaasSubscription } from "./asaas-client";
import { BillingDbError, callRpc, type BillingDb } from "./db";

export type ClaimedEvent = {
  id: number; environment: string; asaas_event_id: string; event_type: string; resource_type: string; resource_id: string | null;
  payload: Record<string, unknown>; attempts: number;
};
export type EventOutcome = { outcome: "processed" | "ignored" | "needs_review" | "retry"; detail?: string };
export type BillingDeps = { db: BillingDb; asaas: AsaasApi; environment: "sandbox"; now?: () => Date };

const IGNORED_PAYMENT_EVENTS = new Set(["PAYMENT_BANK_SLIP_VIEWED", "PAYMENT_CHECKOUT_VIEWED"]);
// Resultados do banco que pedem decisão humana (nunca ativam nem bloqueiam sozinhos).
const REVIEW_OUTCOMES = new Set(["mismatch", "unattributed", "duplicate_subscription", "no_intent", "needs_review", "payment_for_canceled"]);

export function paymentSnapshot(payment: AsaasPayment, observedAt: Date) {
  return {
    id: payment.id, subscription: payment.subscription ?? null, customer: payment.customer, value: payment.value, dueDate: payment.dueDate,
    status: payment.deleted ? "OTHER" : payment.status, billingType: payment.billingType, confirmedDate: payment.confirmedDate ?? null,
    paymentDate: payment.paymentDate ?? null, invoiceUrl: payment.invoiceUrl ?? null, observedAt: observedAt.toISOString(),
  };
}

export function subscriptionSnapshot(subscription: AsaasSubscription | { id: string; deleted: true }) {
  if (!("customer" in subscription)) return { id: subscription.id, deleted: true };
  return { id: subscription.id, customer: subscription.customer, value: subscription.value, cycle: subscription.cycle, status: subscription.status, billingType: subscription.billingType, deleted: subscription.deleted ?? false };
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
