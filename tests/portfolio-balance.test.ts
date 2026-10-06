import { describe, expect, it } from "vitest";
import { balanceText, summarizeBalance } from "@/modules/meta/balance";
import type { ClientAccountBilling } from "@/modules/meta/server";

const account = (patch: Partial<ClientAccountBilling>): ClientAccountBilling => ({
  accountId: "a", name: "Conta", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: true, fundingLabel: null,
  amountSpent: null, spendCap: null, balanceDue: null, availableBalance: null, ...patch,
});

describe("saldo disponível na visão geral", () => {
  it("soma o saldo pré-pago de todas as contas, limitado pelo limite de gastos", () => {
    expect(summarizeBalance([account({ availableBalance: 500 }), account({ availableBalance: 300, spendCap: 1000, amountSpent: 900 })]))
      .toMatchObject({ funds: 600, currency: "BRL", postpaid: false, due: false });
  });

  it("conta só no cartão aparece como pós-paga, e pagamento em aberto tem prioridade", () => {
    expect(summarizeBalance([account({ prepaid: false })])).toMatchObject({ funds: null, postpaid: true });
    expect(summarizeBalance([account({ delivering: false, balanceDue: 42 })]).due).toBe(true);
  });

  it("moedas diferentes não ganham símbolo de moeda", () => {
    expect(summarizeBalance([account({ availableBalance: 10 }), account({ availableBalance: 5, currency: "USD" })]).currency).toBeNull();
  });

  it("descreve o saldo por extenso para a mensagem", () => {
    expect(balanceText({ funds: 1240.5, currency: "BRL", postpaid: false, due: false })).toMatch(/^R\$\s?1\.240,50$/);
    expect(balanceText({ funds: null, currency: "BRL", postpaid: true, due: false })).toBe("pago no cartão (pós-pago)");
    expect(balanceText({ funds: 10, currency: "BRL", postpaid: false, due: true })).toBe("pagamento pendente na Meta");
    expect(balanceText(null)).toBe("—");
  });
});
