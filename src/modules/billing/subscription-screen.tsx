import { CircleAlert, CircleCheck, Clock, Info, LoaderCircle } from "lucide-react";
import { isTrustedCheckoutUrl } from "./checkout-flow";
import { CheckoutForm } from "./checkout-form";
import { formatBRL } from "./offers";
import { ReturnWatcher } from "./return-watcher";
import type { SubscriptionPageData } from "./subscription-data";
import type { ContractView } from "./status-view";

const FORM_STATES = new Set(["idle", "expired", "canceled", "refused", "temporary_error"]);

/** Tela de assinatura e de retorno do checkout. Só mostra o que o servidor confirmou; ninguém é ativado por aqui. */
export function SubscriptionScreen({ data, view, requestKey }: { data: SubscriptionPageData; view: ContractView; requestKey: string }) {
  const { billing } = data;
  const isOwner = data.role === "owner";
  const checkoutUrl = isOwner && isTrustedCheckoutUrl(billing?.pending_checkout?.checkout_url) ? billing?.pending_checkout?.checkout_url ?? null : null;
  const Icon = view.tone === "good" ? CircleCheck : view.tone === "info" ? (view.polling ? LoaderCircle : Clock) : view.tone === "neutral" ? Info : CircleAlert;
  const showForm = data.configured && data.canView && FORM_STATES.has(view.state) && data.offers.length > 0 && !billing?.subscription;

  return <div className="billing-page">
    <header className="page-heading"><div><h1>Assinatura</h1><p>{data.agencyName}</p></div></header>

    {!data.canView ? <section className="panel billing-panel"><p>Somente o proprietário e os administradores consultam a assinatura da organização.</p></section> : <>
      {!data.configured && <section className="panel billing-panel billing-message billing-warn" role="status">A contratação de planos ainda não está disponível neste ambiente.</section>}

      <section className="panel billing-panel" aria-labelledby="billing-status" aria-live="polite">
        <div className="billing-status" data-tone={view.tone}>
          <Icon size={20} aria-hidden="true" className={view.tone === "info" && view.polling ? "billing-spin" : undefined} />
          <div>
            <h2 id="billing-status">{view.title}</h2>
            <p>{view.message}</p>
            {billing?.current_plan && billing.current_plan.kind !== "administrative" && <p className="billing-muted">Plano atual: <strong>{billing.current_plan.name}</strong>{billing.current_plan.kind === "trial" ? " (teste gratuito)" : ""}{billing.subscription ? ` · ${formatBRL(billing.subscription.amount_cents)} ${billing.subscription.cycle === "yearly" ? "por ano" : "por mês"}` : ""}</p>}
            {checkoutUrl && view.state === "awaiting_payment" && <p><a className="button button-primary billing-link" href={checkoutUrl}>Abrir o pagamento seguro</a></p>}
          </div>
        </div>
        {view.polling && <ReturnWatcher />}
      </section>

      {showForm && (isOwner
        ? <section className="panel billing-panel" aria-labelledby="billing-plans"><h2 id="billing-plans">Contratar</h2>
            <CheckoutForm offers={data.offers} requestKey={requestKey} needsBillingData={!data.hasBillingData} canContract /></section>
        : <section className="panel billing-panel"><h2>Planos disponíveis</h2><p className="billing-muted">Somente o proprietário da organização pode contratar ou cancelar. Você pode consultar as informações comerciais.</p>
            <ul className="billing-lines">{data.offers.map((offer) => <li key={offer.plan_version_id}><strong>{offer.name}</strong>{offer.price_monthly_cents ? ` · ${formatBRL(offer.price_monthly_cents)} por mês` : ""}{offer.price_yearly_cents ? ` · ${formatBRL(offer.price_yearly_cents)} por ano` : ""}</li>)}</ul></section>)}
      {data.configured && FORM_STATES.has(view.state) && data.offers.length === 0 && <section className="panel billing-panel"><p className="billing-muted">Nenhum plano está disponível para contratação no momento.</p></section>}
    </>}
  </div>;
}
