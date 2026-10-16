import { formatBRL } from "./offers";
import type { BillingSnapshot } from "./status-view";

// Resumo da assinatura para a tela (somente leitura, a partir do que o servidor gravou). Separa conceitos que NÃO são a mesma coisa:
// estado da assinatura · situação da última cobrança · fim do período JÁ PAGO (direito de acesso) · próxima renovação (cobrança futura).

const dayFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });
const longDate = (value: string | null | undefined) => (value ? dayFormat.format(new Date(value)) : null);
// due_date vem como AAAA-MM-DD (data civil): formatada sem deslocar o fuso.
const civilDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : null);

export type InfoRow = { label: string; value: string; tone?: "good" | "warn" | "bad" | "neutral" };

const CYCLE: Record<string, string> = { monthly: "Mensal", yearly: "Anual" };
const PAID = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);

/** Situação da cobrança mais recente (por vencimento). */
export function describeLatestPayment(payments: BillingSnapshot["payments"]): { text: string; tone: InfoRow["tone"] } | null {
  // Cobrança em atraso tem prioridade: cobranças futuras já geradas (ainda pendentes) não podem esconder o atraso.
  const overdue = [...(payments ?? [])].filter((p) => p.status === "OVERDUE").sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const latest = overdue ?? [...(payments ?? [])].sort((a, b) => b.due_date.localeCompare(a.due_date))[0];
  if (!latest) return null;
  const due = civilDate(latest.due_date);
  if (PAID.has(latest.status)) return { text: `Paga (vencimento em ${due ?? "data indisponível"})`, tone: "good" };
  if (latest.status === "OVERDUE") return { text: `Em atraso (venceu em ${due ?? "data indisponível"})`, tone: "bad" };
  if (latest.status === "PENDING") return { text: `Aguardando pagamento (vence em ${due ?? "data indisponível"})`, tone: "neutral" };
  if (latest.status.startsWith("REFUND") || latest.status.startsWith("CHARGEBACK") || latest.status === "AWAITING_CHARGEBACK_REVERSAL") return { text: "Estorno ou contestação em análise", tone: "warn" };
  return { text: "Em verificação", tone: "neutral" };
}

/** Link da fatura só se for do Asaas (nunca endereço arbitrário). */
export function trustedInvoiceUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && (url.hostname === "sandbox.asaas.com" || url.hostname === "www.asaas.com" || url.hostname === "asaas.com") ? url.toString() : null;
  } catch { return null; }
}

/** Fatura em aberto (atrasada) para a pessoa regularizar, se houver. */
export function openInvoiceLink(payments: BillingSnapshot["payments"]): string | null {
  const overdue = [...(payments ?? [])].filter((p) => p.status === "OVERDUE").sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  return overdue ? trustedInvoiceUrl(overdue.invoice_url) : null;
}

export function describeSubscription(billing: BillingSnapshot | null): InfoRow[] | null {
  const sub = billing?.subscription;
  if (!billing || !sub) return null;
  const canceling = Boolean(sub.cancel_requested_at || sub.cancel_at_period_end);
  const payment = describeLatestPayment(billing.payments);
  const confirming = canceling && Boolean(sub.remote_cancel_pending); // pedido registrado, ainda sem confirmação do Asaas
  const status: InfoRow = sub.status === "active" ? (canceling ? { label: "Estado", value: confirming ? "Cancelamento em processamento (acesso até o fim do período pago)" : "Cancelada, com acesso até o fim do período pago", tone: "warn" } : { label: "Estado", value: "Ativa", tone: "good" })
    : sub.status === "past_due" ? { label: "Estado", value: "Em atraso (tolerância de 7 dias)", tone: "warn" }
    : sub.status === "suspended" ? { label: "Estado", value: "Suspensa por falta de pagamento", tone: "bad" }
    : { label: "Estado", value: "Aguardando confirmação do pagamento", tone: "neutral" };
  const paidUntil = longDate(sub.current_period_end);
  const nextCharge = confirming ? "Aguardando a confirmação do cancelamento" : canceling ? "Sem renovação" : civilDate(sub.next_due_date) ?? longDate(sub.current_period_end) ?? "A definir";
  return [
    { label: "Plano", value: billing.current_plan?.name ?? "Plano contratado" },
    { label: "Periodicidade", value: CYCLE[sub.cycle] ?? sub.cycle },
    { label: "Valor", value: `${formatBRL(sub.amount_cents)} por ${sub.cycle === "yearly" ? "ano" : "mês"}${sub.cycle === "yearly" ? " (cobrança integral)" : ""}` },
    status,
    { label: "Situação do pagamento", value: payment?.text ?? "Sem cobrança registrada", tone: payment?.tone },
    { label: "Acesso pago até", value: paidUntil ?? "A definir" },
    { label: canceling && !confirming ? "Próxima cobrança" : "Próxima renovação", value: nextCharge },
  ];
}

/** O proprietário pode cancelar enquanto houver assinatura viva ainda sem pedido de cancelamento. */
export function canRequestCancel(billing: BillingSnapshot | null, role: string): boolean {
  const sub = billing?.subscription;
  return role === "owner" && Boolean(sub) && ["active", "past_due", "suspended"].includes(sub!.status) && !sub!.cancel_requested_at && !sub!.cancel_at_period_end;
}
