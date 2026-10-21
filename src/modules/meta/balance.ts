import type { ClientAccountBilling } from "./server";

export type BalanceSummary = { funds: number | null; currency: string | null; postpaid: boolean; due: boolean };

// Funds left across the client's ad accounts: prepaid balance or what is left of the spending limit.
export function summarizeBalance(accounts: ClientAccountBilling[]): BalanceSummary {
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

export type AccountBalanceLine = { text: string; tone: "ok" | "warn" | "muted"; detail: string | null };

const moneyOf = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);

/**
 * Situação financeira de UMA conta, para dizer de qual conta é o saldo ou a pendência:
 * pendência de pagamento (com o valor a pagar), conta sem veiculação, saldo pré-pago, limite restante, cartão (pós-pago)
 * ou — no Google Ads, que não informa saldo de cartão — apenas o estado da conta.
 */
export function describeAccountBalance(account: ClientAccountBilling): AccountBalanceLine {
  const due = account.balanceDue ?? 0;
  if (!account.delivering) {
    return { text: due > 0 && account.platform !== "google" ? "Pagamento pendente" : account.statusLabel, tone: "warn",
      detail: due > 0 && account.platform !== "google" ? `${moneyOf(due, account.currency)} a pagar` : null };
  }
  const remainingCap = account.spendCap != null ? Math.max(0, account.spendCap - (account.amountSpent ?? 0)) : null;
  const limits = [account.availableBalance, remainingCap].filter((value): value is number => value != null);
  if (limits.length) {
    const funds = Math.min(...limits);
    return { text: moneyOf(funds, account.currency), tone: funds <= 0 ? "warn" : "ok", detail: account.prepaid ? "saldo pré-pago" : "limite restante" };
  }
  if (account.platform === "google") return { text: account.statusLabel, tone: "muted", detail: "saldo não informado pelo Google" };
  return { text: account.prepaid ? "Sem saldo informado" : "Cartão (pós-pago)", tone: "muted", detail: null };
}

/** The balance in words, as it goes in a message. */
export function balanceText(balance: BalanceSummary | null | undefined) {
  if (!balance) return "—";
  if (balance.due) return "pagamento pendente na Meta";
  if (balance.funds == null) return balance.postpaid ? "pago no cartão (pós-pago)" : "—";
  return balance.currency ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: balance.currency }).format(balance.funds) : balance.funds.toLocaleString("pt-BR");
}
