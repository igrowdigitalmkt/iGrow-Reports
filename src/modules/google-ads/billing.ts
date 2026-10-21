import type { ClientAccountBilling, GoogleBillingExtras, GoogleBillingProbe } from "@/modules/meta/server";

const STATUS_LABELS: Record<string, string> = {
  ENABLED: "Ativa", SUSPENDED: "Suspensa", CANCELED: "Cancelada", CLOSED: "Encerrada", UNKNOWN: "Situação desconhecida", UNSPECIFIED: "Situação desconhecida",
};
const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const micros = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed / 1_000_000 : null;
};

/** O que cada fonte da API devolveu: nada é escondido, para a tela dizer exatamente de onde vem cada número e o que o Google não expõe. */
export type GoogleBillingSources = {
  customerRow: unknown;
  /** Orçamento da conta (contas com faturamento mensal). */
  accountBudgetRows: unknown[] | null;
  /** Cobrança da conta (contas com faturamento mensal): conta de pagamentos vinculada. */
  billingSetupRows: unknown[] | null;
  /** Gasto do mês corrente (métricas da conta). */
  monthCostRows: unknown[] | null;
  /** Campanhas ativas com seus orçamentos (diário e total) e o gasto acumulado. */
  campaignBudgetRows: unknown[] | null;
  probes: GoogleBillingProbe[];
};

/**
 * Situação financeira de uma conta do Google Ads com TUDO o que a API informa (somente leitura):
 * - estado da conta, orçamento da conta aprovado (limite e gasto) e conta de pagamentos, quando a conta usa faturamento mensal;
 * - gasto do mês, orçamento diário somado das campanhas ativas e orçamentos TOTAIS de campanha com o que já foi gasto e o que resta.
 * A API não informa saldo de cartão nem o crédito de pagamentos manuais (Pix, boleto, pré-pago): nesses casos nada é inventado.
 */
export function googleAccountBilling(input: { id: string; name: string; currency: string } & GoogleBillingSources): ClientAccountBilling {
  const customer = object(object(input.customerRow).customer);
  const status = typeof customer.status === "string" ? customer.status : "UNKNOWN";
  const approved = (input.accountBudgetRows ?? []).map(row => object(object(row).accountBudget)).filter(budget => budget.status === undefined || budget.status === "APPROVED");
  // Se houver mais de um orçamento aprovado, vale o de maior limite ainda vigente (sem somar períodos diferentes).
  const budget = approved
    .map(item => ({ limit: micros(item.adjustedSpendingLimitMicros) ?? micros(item.approvedSpendingLimitMicros), served: micros(item.amountServedMicros) }))
    .filter(item => item.limit != null)
    .sort((a, b) => (b.limit ?? 0) - (a.limit ?? 0))[0];

  const setup = (input.billingSetupRows ?? []).map(row => object(object(row).billingSetup)).find(item => !item.status || item.status === "APPROVED") ?? null;
  const payments = setup ? object(setup.paymentsAccountInfo) : {};
  const monthSpend = input.monthCostRows ? input.monthCostRows.reduce<number>((total, row) => total + (micros(object(object(row).metrics).costMicros) ?? 0), 0) : null;

  const campaigns = (input.campaignBudgetRows ?? []).map(row => {
    const item = object(row), campaign = object(item.campaign), campaignBudget = object(item.campaignBudget), metrics = object(item.metrics);
    return { id: text(campaign.id), name: text(campaign.name), daily: micros(campaignBudget.amountMicros), total: micros(campaignBudget.totalAmountMicros), spent: micros(metrics.costMicros) ?? 0 };
  }).filter(item => item.id);
  const dailyBudget = campaigns.length ? campaigns.reduce((total, item) => total + (item.total == null && item.daily != null ? item.daily : 0), 0) : null;
  const totalBudgets = campaigns.filter(item => item.total != null && item.total > 0).map(item => ({ id: item.id, name: item.name, total: item.total!, spent: item.spent, remaining: Math.max(0, item.total! - item.spent) }));

  const extras: GoogleBillingExtras = {
    monthSpend, dailyBudget, totalBudgets, hasBillingSetup: !!setup,
    paymentsAccount: setup ? { id: text(payments.paymentsAccountId) || null, name: text(payments.paymentsAccountName) || text(payments.paymentsProfileName) || null } : null,
    probes: input.probes,
  };
  return {
    platform: "google", accountId: input.id, name: input.name, currency: typeof customer.currencyCode === "string" ? customer.currencyCode : input.currency,
    delivering: status === "ENABLED", statusLabel: STATUS_LABELS[status] ?? "Situação desconhecida",
    prepaid: false, fundingLabel: budget ? "Orçamento da conta" : "Pagamento gerenciado no Google Ads",
    amountSpent: budget ? budget.served : null, spendCap: budget?.limit ?? null, balanceDue: null, availableBalance: null, google: extras,
  };
}
