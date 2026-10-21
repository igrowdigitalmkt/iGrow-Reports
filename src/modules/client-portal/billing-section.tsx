"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, CircleCheck, CreditCard, RefreshCw } from "lucide-react";
import type { ClientAccountBilling } from "@/modules/meta/server";
import { PlatformLogo } from "@/modules/platforms/platform-logo";
import { GoogleCreditDialog } from "./google-credit-dialog";

type BillingState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; accounts: ClientAccountBilling[]; failures: string[] };

const money = (value: number | null | undefined, currency: string) => value == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
// Below this many days of funds at the current pace, the account asks for attention.
const LOW_FUNDS_DAYS = 7;

type Row = {
  account: ClientAccountBilling;
  daily: number;
  /** Money that can still be spent: the smaller of the prepaid balance and the remaining spending limit. */
  funds: number | null;
  days: number | null;
  remainingCap: number | null;
  issue: string | null;
  idle: boolean;
};

function describe(account: ClientAccountBilling, daily: number): Row {
  const remainingCap = account.spendCap != null ? Math.max(0, account.spendCap - (account.amountSpent ?? 0)) : null;
  const limits = [account.availableBalance, remainingCap].filter((value): value is number => value != null);
  const funds = limits.length ? Math.min(...limits) : null;
  const days = funds != null && daily > 0 ? Math.floor(funds / daily) : null;
  const idle = daily === 0 && !(account.balanceDue && account.balanceDue > 0) && (account.availableBalance ?? 0) === 0;
  let issue: string | null = null;
  if (!account.delivering) issue = account.balanceDue ? `${account.statusLabel}: ${money(account.balanceDue, account.currency)} a pagar` : account.statusLabel;
  else if (days != null && days < LOW_FUNDS_DAYS) issue = `${account.availableBalance != null && funds === account.availableBalance ? "Saldo" : "Limite"} para cerca de ${days} ${days === 1 ? "dia" : "dias"}`;
  return { account, daily, funds, days, remainingCap, issue, idle: idle && !issue };
}

/**
 * Balance and payment state of each ad account (Meta and Google Ads), read live from each platform: one aligned row per
 * account, accounts that need action first, unused accounts folded away.
 */
// `accountIds`: só as contas selecionadas no painel aparecem (sem valor, todas as contas do cliente).
export function BillingSummary({ clientId, dailySpend, demoAccounts, accountIds }: { clientId: string; dailySpend: Record<string, number>; demoAccounts?: ClientAccountBilling[]; accountIds?: string[] }) {
  const [state, setState] = useState<BillingState>(demoAccounts ? { status: "ready", accounts: demoAccounts, failures: [] } : { status: "loading" });
  const [showIdle, setShowIdle] = useState(false);

  const load = useCallback(async () => {
    if (demoAccounts) return;
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/clientes/${clientId}/billing`, { cache: "no-store" });
      const body = await response.json() as { accounts?: ClientAccountBilling[]; failures?: string[]; error?: string };
      setState(body.accounts ? { status: "ready", accounts: body.accounts, failures: body.failures ?? [] } : { status: "error", message: body.error ?? "Não foi possível consultar as plataformas agora." });
    } catch {
      setState({ status: "error", message: "Não foi possível consultar as plataformas agora." });
    }
  }, [clientId, demoAccounts]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads external data once per client
  useEffect(() => { void load(); }, [load]);

  const rows = state.status === "ready" ? state.accounts.filter(account => account.platform === "google" || !accountIds || accountIds.includes(account.accountId)).map(account => describe(account, dailySpend[account.accountId] ?? 0))
    .sort((a, b) => Number(!!b.issue) - Number(!!a.issue) || b.daily - a.daily) : [];
  const active = rows.filter(row => !row.idle);
  const idle = rows.filter(row => row.idle);
  const issues = rows.filter(row => row.issue);
  const visible = showIdle ? [...active, ...idle] : active;

  return <section className="billing-strip" aria-label="Saldo e pagamentos" aria-busy={state.status === "loading"}>
    <div className="billing-strip-head">
      <span className="billing-strip-title"><CreditCard size={15} />Saldo e pagamentos</span>
      {state.status === "ready" && rows.length > 0 && (issues.length
        ? <span className="billing-summary is-warn"><AlertTriangle size={14} />{issues.length === 1 ? `${issues[0].account.name}: ${issues[0].issue}` : `${issues.length} contas precisam de atenção`}</span>
        : <span className="billing-summary is-ok"><CircleCheck size={14} />Contas em dia</span>)}
      <span className="billing-head-spacer" />
      {!demoAccounts && state.status !== "loading" && <button type="button" className="icon-button" onClick={() => void load()} aria-label="Consultar saldo novamente" title="Consultar novamente"><RefreshCw size={14} /></button>}
    </div>
    {state.status === "loading" && <div className="billing-rows">{[0, 1].map(index => <div className="billing-row" key={index}>{[38, 22, 22, 26].map((width, cell) => <span key={cell} className="sk" style={{ display: "block", width: `${width + 30}%`, height: cell ? 18 : 14 }} />)}</div>)}</div>}
    {state.status === "error" && <div className="billing-message"><span>{state.message}</span><button type="button" className="text-link" onClick={() => void load()}><RefreshCw size={13} />Tentar novamente</button></div>}
    {state.status === "ready" && state.failures.length > 0 && <div className="billing-message"><span>Não foi possível consultar agora: {state.failures.join(", ")}.</span><button type="button" className="text-link" onClick={() => void load()}><RefreshCw size={13} />Tentar novamente</button></div>}
    {state.status === "ready" && !rows.length && <div className="billing-message"><span>Nenhuma conta de anúncio disponível para consulta.</span></div>}
    {rows.length > 0 && <div className="billing-rows" role="table" aria-label="Contas de anúncio">
      <div className="billing-row billing-row-head" role="row"><span role="columnheader">Conta</span><span role="columnheader">Saldo ou a pagar</span><span role="columnheader">Duração</span><span role="columnheader">Limite de gastos</span></div>
      {visible.map(row => <BillingRow key={row.account.accountId} row={row} clientId={clientId} onChanged={() => void load()} demo={!!demoAccounts} />)}
    </div>}
    {idle.length > 0 && <button type="button" className="billing-idle-toggle" aria-expanded={showIdle} onClick={() => setShowIdle(value => !value)}>
      <ChevronDown size={14} style={{ transform: showIdle ? "rotate(180deg)" : undefined }} />
      {showIdle ? "Ocultar" : "Mostrar"} {idle.length} {idle.length === 1 ? "conta sem uso" : "contas sem uso"}{!showIdle && `: ${idle.map(row => row.account.name).join(", ")}`}
    </button>}
  </section>;
}

function BillingRow({ row, clientId, onChanged, demo }: { row: Row; clientId: string; onChanged: () => void; demo: boolean }) {
  const { account } = row;
  const [creditOpen, setCreditOpen] = useState(false);
  const used = account.spendCap && account.amountSpent != null ? Math.min(1, account.amountSpent / account.spendCap) : null;
  const payment = account.platform === "google" ? (account.fundingLabel ?? "Pagamento no Google Ads") : account.prepaid ? "Pré-pago" : `Pós-pago${account.fundingLabel ? ` · ${account.fundingLabel}` : ""}`;
  const google = account.google;
  const budgetsLeft = google?.totalBudgets.length ? google.totalBudgets.reduce((total, item) => total + item.remaining, 0) : null;
  const budgetsTotal = google?.totalBudgets.reduce((total, item) => total + item.total, 0) ?? 0;
  const budgetsSpent = google?.totalBudgets.reduce((total, item) => total + item.spent, 0) ?? 0;
  const sources = google?.probes.map(item => `${item.source}: ${item.state === "ok" ? "lido" : item.state === "empty" ? "sem dados para esta conta" : `indisponível (${item.message ?? "erro"})`}`).join(" · ");
  return <div className={`billing-row${row.issue ? " has-issue" : ""}${row.idle ? " is-idle" : ""}`} role="row">
    <div className="billing-cell billing-account-cell" role="cell">
      <strong title={account.name} className="billing-account-name"><PlatformLogo platform={account.platform ?? "meta"} size={(account.platform ?? "meta") === "meta" ? 12 : 16} />{account.name}</strong>
      <span className="billing-meta" title={sources ? `Fontes consultadas no Google Ads:
${sources}` : undefined}><span className={`billing-dot ${account.delivering ? "is-ok" : "is-warn"}`} />{account.statusLabel} · {payment}{google?.paymentsAccount?.name ? ` · ${google.paymentsAccount.name}` : ""}</span>
    </div>
    <div className="billing-cell" role="cell">
      {account.prepaid
        ? <><strong>{account.availableBalance != null ? money(account.availableBalance, account.currency) : "—"}</strong><small>saldo pré-pago</small></>
        : account.platform === "google"
          ? google?.credit
            ? <><strong className={google.credit.estimatedBalance <= 0 || google.credit.exceeded ? "is-warn" : undefined}>{money(google.credit.estimatedBalance, account.currency)}</strong>
              <small>saldo estimado · créditos informados {money(google.credit.informed, account.currency)} − gasto {money(google.credit.spentSince, account.currency)} desde {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${google.credit.since}T12:00:00Z`))}{google.credit.exceeded ? " (gasto acima do informado: informe um novo depósito)" : ""}</small></>
          : budgetsLeft != null
            ? <><strong>{money(budgetsLeft, account.currency)}</strong><small>restantes nos orçamentos totais das campanhas ativas</small></>
            : <><strong className="is-muted">—</strong><small>crédito da conta não informado pelo Google</small></>
          : <><strong className={account.balanceDue && !account.delivering ? "is-warn" : undefined}>{money(account.balanceDue, account.currency)}</strong><small>a pagar</small></>}
      {account.platform === "google" && !demo && <>
        <button type="button" className="text-link credit-link" onClick={() => setCreditOpen(true)}>{google?.credit ? "Editar créditos informados" : "Informar crédito (Pix, boleto)"}</button>
        <GoogleCreditDialog open={creditOpen} onOpenChange={setCreditOpen} clientId={clientId} accountId={account.accountId} accountName={account.name} currency={account.currency}
          entries={google?.credit?.entries ?? []} onChanged={onChanged} />
      </>}
    </div>
    <div className="billing-cell" role="cell">
      {account.platform === "google" && row.days == null && google?.monthSpend != null
        ? <><strong>{money(google.monthSpend, account.currency)}</strong><small>gasto neste mês{google.dailyBudget ? ` · orçamento diário ${money(google.dailyBudget, account.currency)}` : ""}</small></>
        : row.days != null
        ? <><strong className={row.days < LOW_FUNDS_DAYS ? "is-warn" : undefined}>{row.days} {row.days === 1 ? "dia" : "dias"}</strong><small>{money(row.daily, account.currency)} por dia</small></>
        : <><strong className="is-muted">{row.daily > 0 ? money(row.daily, account.currency) : "—"}</strong><small>{row.daily > 0 ? "média por dia" : "sem investimento no período"}</small></>}
    </div>
    <div className="billing-cell" role="cell">
      {account.spendCap == null && budgetsLeft != null
        ? <><strong>{money(budgetsTotal, account.currency)}</strong><div className="billing-track" aria-hidden="true"><i style={{ width: `${budgetsTotal ? Math.min(100, budgetsSpent / budgetsTotal * 100) : 0}%` }} /></div><small>definidos nas campanhas · gasto {money(budgetsSpent, account.currency)}</small></>
        : account.spendCap != null
        ? <><strong>{money(row.remainingCap, account.currency)}</strong><div className="billing-track" aria-hidden="true"><i style={{ width: `${(used ?? 0) * 100}%` }} className={(used ?? 0) > .9 ? "is-high" : ""} /></div><small>restantes de {money(account.spendCap, account.currency)}</small></>
        : <><strong className="is-muted">{account.platform === "google" ? "Sem limite informado" : "Sem limite"}</strong><small>{account.amountSpent != null ? `${money(account.amountSpent, account.currency)} gastos desde a criação` : account.platform === "google" ? "limite de cartão não exposto pela API" : "—"}</small></>}
    </div>
  </div>;
}
