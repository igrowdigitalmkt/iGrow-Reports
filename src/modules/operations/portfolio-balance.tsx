"use client";

import { useEffect, useState } from "react";
import type { ClientAccountBilling } from "@/modules/meta/server";

type Balance = { status: "loading" } | { status: "ready"; funds: number | null; currency: string | null; postpaid: boolean; due: boolean } | { status: "error" };

// Funds left across the client's ad accounts: prepaid balance or what is left of the spending limit.
export function summarizeBalance(accounts: ClientAccountBilling[]) {
  let funds: number | null = null;
  for (const account of accounts) {
    const remainingCap = account.spendCap != null ? Math.max(0, account.spendCap - (account.amountSpent ?? 0)) : null;
    const limits = [account.availableBalance, remainingCap].filter((value): value is number => value != null);
    if (limits.length) funds = (funds ?? 0) + Math.min(...limits);
  }
  const currencies = new Set(accounts.map(account => account.currency));
  return {
    funds, currency: currencies.size === 1 ? [...currencies][0] : null,
    postpaid: funds == null && accounts.some(account => !account.prepaid),
    due: accounts.some(account => (account.balanceDue ?? 0) > 0 && !account.delivering),
  };
}

export function ClientBalance({ clientId, enabled, demo }: { clientId: string; enabled: boolean; demo?: { funds: number | null; postpaid?: boolean } }) {
  const [state, setState] = useState<Balance>(demo ? { status: "ready", funds: demo.funds, currency: "BRL", postpaid: !!demo.postpaid, due: false } : { status: "loading" });
  useEffect(() => {
    if (demo || !enabled) return;
    let cancelled = false;
    fetch(`/api/clientes/${clientId}/billing`, { cache: "no-store" }).then(response => response.json()).then((body: { accounts?: ClientAccountBilling[] }) => {
      if (!cancelled) setState(body.accounts ? { status: "ready", ...summarizeBalance(body.accounts) } : { status: "error" });
    }).catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, [clientId, enabled, demo]);

  if (!enabled) return <span className="muted">—</span>;
  if (state.status === "loading") return <span className="sk" style={{ display: "inline-block", width: 72, height: 14 }} aria-label="Carregando saldo" />;
  if (state.status === "error") return <span className="muted" title="Não foi possível consultar a Meta agora.">—</span>;
  if (state.due) return <span className="balance-due">Pagamento pendente</span>;
  if (state.funds == null) return <span className="muted">{state.postpaid ? "Cartão (pós-pago)" : "—"}</span>;
  const text = state.currency ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: state.currency }).format(state.funds) : state.funds.toLocaleString("pt-BR");
  return <span className={state.funds <= 0 ? "balance-due" : undefined}>{text}</span>;
}
