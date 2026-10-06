"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CreditCard, RefreshCw } from "lucide-react";
import type { ClientAccountBilling } from "@/modules/meta/server";

type BillingState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: ClientAccountBilling[] };

const money = (value: number | null | undefined, currency: string) => value == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
// Below this many days of funds at the current pace, the strip asks for attention.
const LOW_FUNDS_DAYS = 7;

/**
 * Balance and payment state of each ad account, read live from Meta: the first thing a
 * client looks for. `dailySpend` (average per account in the selected period) turns the
 * balance or the spending limit into "how many days are left".
 */
export function BillingSummary({ clientId, dailySpend, demoAccounts }: { clientId: string; dailySpend: Record<string, number>; demoAccounts?: ClientAccountBilling[] }) {
  const [state, setState] = useState<BillingState>(demoAccounts ? { status: "ready", accounts: demoAccounts } : { status: "loading" });

  const load = useCallback(async () => {
    if (demoAccounts) return;
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/clientes/${clientId}/billing`, { cache: "no-store" });
      const body = await response.json() as { accounts?: ClientAccountBilling[]; error?: string };
      setState(body.accounts ? { status: "ready", accounts: body.accounts } : { status: "error", message: body.error ?? "Não foi possível consultar a Meta agora." });
    } catch {
      setState({ status: "error", message: "Não foi possível consultar a Meta agora." });
    }
  }, [clientId, demoAccounts]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads external data once per client
  useEffect(() => { void load(); }, [load]);

  const accounts = state.status === "ready" ? state.accounts : [];
  return <section className={`billing-strip${accounts.length === 1 ? " is-single" : ""}`} aria-label="Saldo e pagamentos" aria-busy={state.status === "loading"}>
    <div className="billing-strip-head">
      <span className="billing-strip-title"><CreditCard size={15} />Saldo e pagamentos</span>
      {!demoAccounts && state.status !== "loading" && <button type="button" className="icon-button" onClick={() => void load()} aria-label="Consultar saldo novamente" title="Consultar novamente"><RefreshCw size={14} /></button>}
    </div>
    {state.status === "loading" && <div className="billing-accounts"><div className="billing-account">{[0, 1, 2, 3].map(index => <div className="billing-stat" key={index}><span className="sk" style={{ display: "block", width: "50%", height: 12 }} /><span className="sk" style={{ display: "block", width: "70%", height: 22, marginTop: 8 }} /></div>)}</div></div>}
    {state.status === "error" && <div className="billing-message"><span>{state.message}</span><button type="button" className="text-link" onClick={() => void load()}><RefreshCw size={13} />Tentar novamente</button></div>}
    {state.status === "ready" && !accounts.length && <div className="billing-message"><span>Nenhuma conta de anúncio disponível para consulta.</span></div>}
    {accounts.length > 0 && <div className="billing-accounts">{accounts.map(account => <AccountBilling key={account.accountId} account={account} daily={dailySpend[account.accountId] ?? 0} showName={accounts.length > 1} />)}</div>}
  </section>;
}

function AccountBilling({ account, daily, showName }: { account: ClientAccountBilling; daily: number; showName: boolean }) {
  const remainingCap = account.spendCap != null ? Math.max(0, account.spendCap - (account.amountSpent ?? 0)) : null;
  const funds = account.availableBalance ?? remainingCap;
  const days = funds != null && daily > 0 ? Math.floor(funds / daily) : null;
  const low = days != null && days < LOW_FUNDS_DAYS;
  const used = account.spendCap && account.amountSpent != null ? Math.min(1, account.amountSpent / account.spendCap) : null;
  return <article className={`billing-account${low ? " is-low" : ""}`}>
    {showName && <div className="billing-account-name"><strong>{account.name}</strong></div>}
    <div className="billing-stat">
      <span className="billing-label">Situação da conta</span>
      <span className={`badge ${account.delivering ? "green" : "amber"}`}><span className="status-dot" />{account.statusLabel}</span>
      <small title={account.fundingLabel ?? undefined}>{account.prepaid ? "Pré-pago" : "Pós-pago"}{account.fundingLabel && !account.availableBalance ? ` · ${account.fundingLabel}` : ""}</small>
    </div>
    <div className="billing-stat">
      {account.prepaid
        ? <><span className="billing-label">Saldo disponível</span><strong>{account.availableBalance != null ? money(account.availableBalance, account.currency) : "Ver na Meta"}</strong><small>{account.availableBalance != null ? "créditos para veicular" : "a Meta não informou o valor"}</small></>
        : <><span className="billing-label">Valor a pagar</span><strong>{money(account.balanceDue, account.currency)}</strong><small>cobrado na forma de pagamento</small></>}
    </div>
    <div className="billing-stat">
      <span className="billing-label">{days != null ? "Duração estimada" : "Média diária"}</span>
      <strong className={low ? "is-warn" : undefined}>{days != null ? `${days} ${days === 1 ? "dia" : "dias"}` : money(daily || null, account.currency)}</strong>
      <small>{days != null ? `no ritmo de ${money(daily, account.currency)} por dia` : "investimento médio no período"}</small>
    </div>
    <div className="billing-stat">
      <span className="billing-label">{account.spendCap != null ? "Limite de gastos" : "Gasto total da conta"}</span>
      <strong>{account.spendCap != null ? money(remainingCap, account.currency) : money(account.amountSpent, account.currency)}</strong>
      {used != null && account.spendCap != null ? <><div className="billing-track" aria-hidden="true"><i style={{ width: `${used * 100}%` }} className={used > .9 ? "is-high" : ""} /></div><small>disponíveis de {money(account.spendCap, account.currency)}</small></> : <small>desde a criação da conta</small>}
    </div>
    {low && <p className="billing-alert"><AlertTriangle size={14} />{account.availableBalance != null ? "Saldo" : "Limite"} suficiente para cerca de {days} {days === 1 ? "dia" : "dias"}. Programe uma recarga para não pausar os anúncios.</p>}
  </article>;
}
