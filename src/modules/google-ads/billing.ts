import type { ClientAccountBilling } from "@/modules/meta/server";

const STATUS_LABELS: Record<string, string> = {
  ENABLED: "Ativa", SUSPENDED: "Suspensa", CANCELED: "Cancelada", CLOSED: "Encerrada", UNKNOWN: "Situação desconhecida", UNSPECIFIED: "Situação desconhecida",
};
const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const micros = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed / 1_000_000 : null;
};

/**
 * Situação e limite de uma conta do Google Ads, a partir de leituras (somente leitura) da própria API: estado da conta e orçamento
 * aprovado da conta, quando existir (contas com cobrança por fatura ou pré-pago). A API não expõe saldo de cartão: nesse caso o
 * limite fica vazio e a tela diz que não há limite informado, nunca um valor inventado.
 */
export function googleAccountBilling(input: { id: string; name: string; currency: string; customerRow: unknown; budgetRows: unknown[] | null }): ClientAccountBilling {
  const customer = object(object(input.customerRow).customer);
  const status = typeof customer.status === "string" ? customer.status : "UNKNOWN";
  const approved = (input.budgetRows ?? []).map(row => object(object(row).accountBudget)).filter(budget => budget.status === undefined || budget.status === "APPROVED");
  // Se houver mais de um orçamento aprovado, vale o de maior limite ainda vigente (sem somar períodos diferentes).
  const budget = approved
    .map(item => ({ limit: micros(item.adjustedSpendingLimitMicros) ?? micros(item.approvedSpendingLimitMicros), served: micros(item.amountServedMicros) }))
    .filter(item => item.limit != null)
    .sort((a, b) => (b.limit ?? 0) - (a.limit ?? 0))[0];
  return {
    platform: "google", accountId: input.id, name: input.name, currency: typeof customer.currencyCode === "string" ? customer.currencyCode : input.currency,
    delivering: status === "ENABLED", statusLabel: STATUS_LABELS[status] ?? "Situação desconhecida",
    prepaid: false, fundingLabel: budget ? "Orçamento da conta" : "Pagamento gerenciado no Google Ads",
    amountSpent: budget ? budget.served : null, spendCap: budget?.limit ?? null, balanceDue: null, availableBalance: null,
  };
}
