"use client";

import { useEffect, useState } from "react";
import type { ClientAccountBilling } from "@/modules/meta/server";
import { describeAccountBalance, summarizeBalance } from "@/modules/meta/balance";
import { PlatformLogo } from "@/modules/platforms/platform-logo";

type Balance =
  | { status: "loading" }
  | { status: "ready"; accounts: ClientAccountBilling[] | null; failures?: string[]; funds: number | null; currency: string | null; postpaid: boolean; due: boolean }
  | { status: "error" };

const money = (value: number, currency: string | null) => currency ? new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value) : value.toLocaleString("pt-BR");

/**
 * Saldo e pagamento do cliente, dizendo DE QUAL CONTA é cada valor ou pendência. Um cliente com várias contas mostra o total (só das
 * contas Meta, que informam saldo) e, abaixo, uma linha por conta, de qualquer plataforma, com a logo da plataforma.
 */
export function ClientBalance({ clientId, enabled, demo }: { clientId: string; enabled: boolean; demo?: { funds: number | null; postpaid?: boolean } }) {
  const [state, setState] = useState<Balance>(demo ? { status: "ready", accounts: null, funds: demo.funds, currency: "BRL", postpaid: !!demo.postpaid, due: false } : { status: "loading" });
  useEffect(() => {
    if (demo || !enabled) return;
    let cancelled = false;
    fetch(`/api/clientes/${clientId}/billing`, { cache: "no-store" }).then(response => response.json()).then((body: { accounts?: ClientAccountBilling[]; failures?: string[] }) => {
      if (cancelled) return;
      if (!body.accounts) { setState({ status: "error" }); return; }
      setState({ status: "ready", accounts: body.accounts, failures: body.failures ?? [], ...summarizeBalance(body.accounts.filter(account => account.platform !== "google")) });
    }).catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, [clientId, enabled, demo]);

  if (!enabled) return <span className="muted">—</span>;
  if (state.status === "loading") return <span className="sk" style={{ display: "inline-block", width: 72, height: 14 }} aria-label="Carregando saldo" />;
  if (state.status === "error") return <span className="muted" title="Não foi possível consultar as plataformas agora.">—</span>;

  const accounts = state.accounts ?? [];
  const lines = accounts.map(account => ({ account, line: describeAccountBalance(account) }));
  const failed = state.failures?.length ? `${state.failures.join(", ")}: não consultado agora` : null;
  const toneClass = (tone: "ok" | "warn" | "muted") => tone === "warn" ? "balance-due" : tone === "muted" ? "muted" : undefined;

  // Sem a lista de contas (demonstração): só o resumo.
  if (!accounts.length) {
    if (state.due) return <span className="balance-due">Pagamento pendente</span>;
    if (state.funds == null) return <span className="muted">{state.postpaid ? "Cartão (pós-pago)" : "—"}</span>;
    return <span className={state.funds <= 0 ? "balance-due" : undefined}>{money(state.funds, state.currency)}</span>;
  }

  // Uma única conta: o valor e, embaixo, de qual conta é.
  if (lines.length === 1) {
    const { account, line } = lines[0]!;
    return <div className="balance-cell">
      <strong className={toneClass(line.tone)}>{line.text}</strong>
      <small className="balance-account-name"><PlatformLogo platform={account.platform ?? "meta"} size={(account.platform ?? "meta") === "meta" ? 11 : 14} />{account.name}{line.detail ? ` · ${line.detail}` : ""}</small>
      {failed && <small className="muted">{failed}</small>}
    </div>;
  }

  // Várias contas: o total das que informam saldo e a situação de cada uma.
  const headline = state.due ? { text: "Pagamento pendente", tone: "warn" as const }
    : state.funds != null ? { text: money(state.funds, state.currency), tone: state.funds <= 0 ? "warn" as const : "ok" as const }
    : state.postpaid ? { text: "Cartão (pós-pago)", tone: "muted" as const } : { text: "—", tone: "muted" as const };
  return <div className="balance-cell">
    <strong className={toneClass(headline.tone)}>{headline.text}</strong>
    <ul className="balance-accounts" aria-label="Situação de cada conta">
      {failed && <li className="muted">{failed}</li>}
      {lines.map(({ account, line }) => <li key={account.accountId} title={`${account.name}: ${line.text}${line.detail ? ` (${line.detail})` : ""}`}>
        <PlatformLogo platform={account.platform ?? "meta"} size={(account.platform ?? "meta") === "meta" ? 11 : 14} />
        <span className="balance-account-name">{account.name}</span>
        <em className={toneClass(line.tone)}>{line.text}</em>
      </li>)}
    </ul>
  </div>;
}
