import "server-only";
import { AsaasError } from "./asaas-client";
import { callRpc } from "./db";
import { applyPayment, applySubscription, applySubscriptionAndPayments, REVIEW_OUTCOMES, type BillingDeps } from "./event-processor";

type Work = {
  reconcile: { id: string; environment: string; asaas_subscription_id: string }[];
  remote_cancel: { id: string; environment: string; asaas_subscription_id: string }[];
  intents?: IntentToCheck[];
};
export type IntentToCheck = { id: string; environment: string; status: string; asaas_customer_id: string };
export type ReconcileSummary = { checked: number; remoteCanceled: number; failed: number; intentsChecked: number; intentsResolved: number; intentsVerified: number };

const LIST_LIMIT = 100; // lista com 100 resultados pode estar truncada: nesse caso a conferência NÃO é conclusiva
const isLive = (subscription: { deleted?: boolean | null; status: string }) => !subscription.deleted && !["INACTIVE", "EXPIRED"].includes(subscription.status.toUpperCase());

/**
 * Confere no Asaas (fonte de verdade) se uma contratação cuja intenção está em aberto, com resultado desconhecido ou expirada no relógio
 * local já gerou assinatura. Lista só as assinaturas do cliente financeiro DESSA organização e aplica cada uma pelo caminho verificado
 * (cliente, valor, ciclo, cartão e vínculo com o checkout conferidos). Nada é ativado por aproximação.
 * Uma intenção expirada só é marcada como "conferida" (liberando nova contratação) se a lista veio completa e nenhuma assinatura
 * ficou pendente de revisão humana.
 */
export async function verifyIntentWithAsaas(deps: BillingDeps, item: IntentToCheck): Promise<{ created: number; verified: boolean }> {
  const subscriptions = await deps.asaas.listCustomerSubscriptions(item.asaas_customer_id, LIST_LIMIT);
  const outcomes: string[] = [];
  for (const subscription of subscriptions.filter(isLive)) outcomes.push(...await applySubscriptionAndPayments(deps, subscription, null));
  const created = outcomes.filter((outcome) => outcome === "created").length;
  let verified = false;
  if (item.status === "expired" && subscriptions.length < LIST_LIMIT && !outcomes.some((outcome) => REVIEW_OUTCOMES.has(outcome))) {
    verified = Boolean(await callRpc<boolean>(deps.db, "billing_mark_intent_verified", { p_intent_id: item.id }).catch(() => false));
  }
  return { created, verified };
}

/**
 * Antes de abrir uma nova contratação: confere no Asaas as anteriores que expiraram mas podem ter sido pagas.
 * "clear" = pode contratar (se uma assinatura foi recuperada, a nova contratação será recusada como "já assinante"); "pending" = ainda
 * não é possível saber (Asaas indisponível ou caso para revisão): a pessoa vê "verificando" e nenhuma cobrança nova é criada.
 */
export async function verifyBeforeContracting(deps: BillingDeps, agencyId: string): Promise<"clear" | "pending"> {
  try {
    const candidates = await callRpc<IntentToCheck[]>(deps.db, "billing_recovery_candidates", { p_agency_id: agencyId, p_environment: deps.environment });
    for (const candidate of candidates) {
      const result = await verifyIntentWithAsaas(deps, { ...candidate, environment: deps.environment });
      if (!result.verified && result.created === 0) return "pending";
    }
    return "clear";
  } catch {
    return "pending";
  }
}

/**
 * Reconciliação com o Asaas: reaplica o estado REAL (lido na API) das assinaturas e conclui cancelamentos pendentes.
 * Reaplicar é seguro porque as funções do banco são idempotentes e ignoram retratos antigos.
 */
export async function reconcileBilling(deps: BillingDeps, options: { limit?: number; deadlineMs?: number } = {}): Promise<ReconcileSummary> {
  const work = await callRpc<Work>(deps.db, "billing_reconcile_work", { p_limit: options.limit ?? 20, p_environment: deps.environment });
  const summary: ReconcileSummary = { checked: 0, remoteCanceled: 0, failed: 0, intentsChecked: 0, intentsResolved: 0, intentsVerified: 0 };

  // Contratações em aberto, com resultado desconhecido ou expiradas no relógio local: o banco as reivindica (sem execução duplicada) e o
  // Asaas diz se já existe assinatura. Falha temporária não perde nada: a próxima rodada confere de novo.
  for (const item of (work.intents ?? []).filter((entry) => entry.environment === deps.environment)) {
    if (options.deadlineMs && Date.now() > options.deadlineMs) break;
    try {
      const result = await verifyIntentWithAsaas(deps, item);
      summary.intentsChecked += 1;
      summary.intentsResolved += result.created;
      if (result.verified) summary.intentsVerified += 1;
    } catch { summary.failed += 1; }
  }

  const outOfTime = () => Boolean(options.deadlineMs && Date.now() > options.deadlineMs);
  for (const item of work.remote_cancel.filter((entry) => entry.environment === deps.environment)) {
    if (outOfTime()) break;
    try {
      try { await deps.asaas.cancelSubscription(item.asaas_subscription_id); }
      catch (error) { if (!(error instanceof AsaasError && error.status === 404)) throw error; } // já não existe no Asaas
      await callRpc(deps.db, "billing_confirm_remote_cancel", { p_subscription_id: item.id });
      summary.remoteCanceled += 1;
    } catch { summary.failed += 1; }
  }

  for (const item of work.reconcile.filter((entry) => entry.environment === deps.environment)) {
    if (outOfTime()) break;
    try {
      const observedAt = (deps.now ?? (() => new Date()))();
      try {
        const subscription = await deps.asaas.getSubscription(item.asaas_subscription_id);
        await applySubscription(deps, subscription, null);
      } catch (error) {
        if (error instanceof AsaasError && error.status === 404) {
          // Assinatura que já não existe no Asaas: o fato é registrado pelo caminho verificado e a conferência está CONCLUÍDA (não há cobranças a listar);
          // sem isso ela falharia para sempre e ocuparia vagas da reconciliação.
          await applySubscription(deps, { id: item.asaas_subscription_id, deleted: true }, null);
          await callRpc(deps.db, "billing_mark_reconciled", { p_subscription_id: item.id });
          summary.checked += 1;
          continue;
        }
        throw error;
      }
      const payments = await deps.asaas.listSubscriptionPayments(item.asaas_subscription_id, 12);
      for (const payment of [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) await applyPayment(deps, payment, observedAt, null, null);
      await callRpc(deps.db, "billing_mark_reconciled", { p_subscription_id: item.id });
      summary.checked += 1;
    } catch { summary.failed += 1; }
  }
  return summary;
}
