import "server-only";
import { AsaasError } from "./asaas-client";
import { callRpc } from "./db";
import { applyPayment, applySubscription, type BillingDeps } from "./event-processor";

type Work = {
  reconcile: { id: string; environment: string; asaas_subscription_id: string }[];
  remote_cancel: { id: string; environment: string; asaas_subscription_id: string }[];
  intents?: { id: string; environment: string; asaas_customer_id: string }[];
};
export type ReconcileSummary = { checked: number; remoteCanceled: number; failed: number; intentsChecked: number; intentsResolved: number };

/**
 * Reconciliação com o Asaas: reaplica o estado REAL (lido na API) das assinaturas e conclui cancelamentos pendentes.
 * Reaplicar é seguro porque as funções do banco são idempotentes e ignoram retratos antigos.
 */
export async function reconcileBilling(deps: BillingDeps, options: { limit?: number; deadlineMs?: number } = {}): Promise<ReconcileSummary> {
  const work = await callRpc<Work>(deps.db, "billing_reconcile_work", { p_limit: options.limit ?? 20 });
  const summary: ReconcileSummary = { checked: 0, remoteCanceled: 0, failed: 0, intentsChecked: 0, intentsResolved: 0 };

  // Contratação com resultado desconhecido: o estado REAL no Asaas diz se a assinatura já existe (então é registrada pelo caminho
  // normal, que confere cliente, valor e ciclo). Se não existir, nada é feito: a intenção só expira quando o checkout vencer.
  for (const item of (work.intents ?? []).filter((entry) => entry.environment === deps.environment)) {
    if (options.deadlineMs && Date.now() > options.deadlineMs) break;
    try {
      const subscriptions = await deps.asaas.listCustomerSubscriptions(item.asaas_customer_id, 20);
      summary.intentsChecked += 1;
      for (const subscription of subscriptions) {
        if (subscription.deleted || ["INACTIVE", "EXPIRED"].includes(subscription.status.toUpperCase())) continue;
        if ((await applySubscription(deps, subscription, null)) === "created") summary.intentsResolved += 1;
      }
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
        if (error instanceof AsaasError && error.status === 404) { await applySubscription(deps, { id: item.asaas_subscription_id, deleted: true }, null); }
        else throw error;
      }
      const payments = await deps.asaas.listSubscriptionPayments(item.asaas_subscription_id, 12);
      for (const payment of [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) await applyPayment(deps, payment, observedAt, null, null);
      await callRpc(deps.db, "billing_mark_reconciled", { p_subscription_id: item.id });
      summary.checked += 1;
    } catch { summary.failed += 1; }
  }
  return summary;
}
