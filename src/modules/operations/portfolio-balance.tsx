"use client";

import { useEffect, useState } from "react";
import type { ClientAccountBilling } from "@/modules/meta/server";
import { summarizeBalance } from "@/modules/meta/balance";

type Balance = { status: "loading" } | { status: "ready"; funds: number | null; currency: string | null; postpaid: boolean; due: boolean } | { status: "error" };

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
