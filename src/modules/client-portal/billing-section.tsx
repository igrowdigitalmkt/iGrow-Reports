"use client";

import { useEffect, useState } from "react";
import { CreditCard, Info, RefreshCw } from "lucide-react";
import { getClientBilling } from "./analytics-scope-actions";
import type { ClientAccountBilling } from "@/modules/meta/server";

const money = (value: number | null, currency: string) => value == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);

type BillingState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: ClientAccountBilling[] };

// Current balance and payment state of each linked ad account, read live from Meta.
export function BillingSection({ clientId }: { clientId: string }) {
  const [state, setState] = useState<BillingState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getClientBilling({ clientId }).then(result => {
      if (cancelled) return;
      setState("error" in result ? { status: "error", message: result.error ?? "Não foi possível consultar a Meta agora." } : { status: "ready", accounts: result.accounts });
    }).catch(() => { if (!cancelled) setState({ status: "error", message: "Não foi possível consultar a Meta agora." }); });
    return () => { cancelled = true; };
  }, [clientId, attempt]);

  return <section className="analytics-card billing-card" aria-busy={state.status === "loading"}>
    <div className="analytics-card-heading"><div><h3>Saldo e pagamentos</h3><p className="billing-subtitle">Situação atual das contas de anúncio na Meta</p></div><CreditCard size={17} /></div>
    {state.status === "loading" && <div className="billing-grid">{[0, 1].map(index => <div className="billing-account" key={index}><span className="sk" style={{ display: "block", width: "60%", height: 16 }} /><span className="sk" style={{ display: "block", width: "45%", height: 26, marginTop: 14 }} /><span className="sk" style={{ display: "block", width: "100%", height: 6, marginTop: 18, borderRadius: 99 }} /></div>)}</div>}
    {state.status === "error" && <div className="analytics-empty-copy billing-error"><span>{state.message}</span><button type="button" className="analytics-text-button" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}><RefreshCw size={13} />Tentar novamente</button></div>}
    {state.status === "ready" && !state.accounts.length && <p className="analytics-empty-copy">Nenhuma conta de anúncio disponível para consulta.</p>}
    {state.status === "ready" && state.accounts.length > 0 && <div className="billing-grid">{state.accounts.map(account => {
      const used = account.spendCap && account.amountSpent != null ? Math.min(1, account.amountSpent / account.spendCap) : null;
      return <article className="billing-account" key={account.accountId}>
        <div className="billing-account-head"><strong>{account.name}</strong><span className={`badge ${account.delivering ? "green" : "amber"}`}><span className="status-dot" />{account.statusLabel}</span></div>
        <dl className="billing-figures">
          <div><dt>{account.prepaid ? "Pré-pago" : "Forma de pagamento"}</dt><dd className="billing-funding">{account.fundingLabel ?? (account.prepaid ? "Saldo pré-pago" : "Não informada pela Meta")}</dd></div>
          {!account.prepaid && <div><dt>Valor a pagar</dt><dd>{money(account.balanceDue, account.currency)}</dd></div>}
          <div><dt>Gasto total da conta</dt><dd>{money(account.amountSpent, account.currency)}</dd></div>
        </dl>
        {used != null && account.spendCap != null && <div className="billing-cap">
          <div className="billing-cap-label"><span>Limite de gastos</span><span>{money(Math.max(0, account.spendCap - (account.amountSpent ?? 0)), account.currency)} disponíveis de {money(account.spendCap, account.currency)}</span></div>
          <div className="billing-cap-track"><i style={{ width: `${used * 100}%` }} className={used > .9 ? "is-high" : ""} /></div>
        </div>}
      </article>;
    })}</div>}
    <p className="analytics-footnote billing-note"><Info size={12} />Dados lidos agora na Meta. O histórico de depósitos e pagamentos não é disponibilizado pela API e pode ser consultado no Gerenciador de Anúncios.</p>
  </section>;
}
