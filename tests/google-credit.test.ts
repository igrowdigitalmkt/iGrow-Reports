import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/billing/guard", () => ({ ensurePaidOperation: async () => undefined, paidOperationBlock: async () => null, billingBlockOf: () => null, BillingRestrictedError: class extends Error {} }));
import { creditInputSchema, estimateCredit, type CreditEntry } from "@/modules/google-ads/credit-balance";
import { parseMoneyInput } from "@/modules/client-portal/google-credit-dialog";
import { describeAccountBalance } from "@/modules/meta/balance";
import type { ClientAccountBilling } from "@/modules/meta/server";

const entry = (amount: number, depositedOn: string, currency = "BRL"): CreditEntry => ({ id: `${depositedOn}-${amount}`, amount, currency, depositedOn, note: null, createdAt: "2026-10-21T00:00:00Z" });

describe("saldo estimado a partir dos créditos informados", () => {
  it("créditos − gasto desde o primeiro depósito", () => {
    expect(estimateCredit([entry(40, "2026-10-13")], 12.5)).toMatchObject({ informed: 40, since: "2026-10-13", spentSince: 12.5, estimatedBalance: 27.5, exceeded: false });
  });
  it("vários depósitos formam um saldo só; o gasto conta desde o mais antigo", () => {
    const result = estimateCredit([entry(40, "2026-10-13"), entry(100, "2026-10-18")], 30)!;
    expect(result).toMatchObject({ informed: 140, since: "2026-10-13", estimatedBalance: 110 });
  });
  it("gasto acima do informado zera o saldo e avisa, nunca fica negativo", () => {
    expect(estimateCredit([entry(40, "2026-10-13")], 55)).toMatchObject({ estimatedBalance: 0, exceeded: true });
  });
  it("sem créditos, gasto inválido ou moedas misturadas: nenhuma estimativa inventada", () => {
    expect(estimateCredit([], 10)).toBeNull();
    expect(estimateCredit([entry(40, "2026-10-13")], Number.NaN)).toBeNull();
    expect(estimateCredit([entry(40, "2026-10-13")], -1)).toBeNull();
    expect(estimateCredit([entry(40, "2026-10-13", "BRL"), entry(10, "2026-10-14", "USD")], 1)).toBeNull();
  });
  it("arredonda em centavos", () => {
    expect(estimateCredit([entry(40, "2026-10-13")], 0.1 + 0.2)?.estimatedBalance).toBe(39.7);
  });
});

describe("formulário de crédito", () => {
  const base = { clientId: "7f8b5d9e-3b2a-4c1d-9e6f-0a1b2c3d4e5f", accountId: "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d", amount: 40, depositedOn: "2026-10-13" };
  it("valida valor, data e observação", () => {
    expect(creditInputSchema.safeParse(base).success).toBe(true);
    for (const over of [{ amount: 0 }, { amount: -5 }, { amount: 12.345 }, { amount: 1e9 }, { depositedOn: "13/10/2026" }, { note: "x".repeat(201) }, { clientId: "nao-e-uuid" }]) {
      expect(creditInputSchema.safeParse({ ...base, ...over }).success, JSON.stringify(over)).toBe(false);
    }
  });
  it("interpreta valores no formato brasileiro e simples", () => {
    expect(parseMoneyInput("40")).toBe(40);
    expect(parseMoneyInput("40,50")).toBe(40.5);
    expect(parseMoneyInput("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoneyInput("1234.56")).toBe(1234.56);
    expect(parseMoneyInput("1.234")).toBe(1234);
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
  });
});

describe("linha de saldo do Google com crédito informado", () => {
  const account = (credit?: object): ClientAccountBilling => ({ accountId: "a", name: "Conta", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: false, fundingLabel: null,
    amountSpent: null, spendCap: null, balanceDue: null, availableBalance: null, platform: "google",
    google: { monthSpend: 0, dailyBudget: null, totalBudgets: [], hasBillingSetup: true, paymentsAccount: null, probes: [], ...(credit ? { credit } : {}) } as never });
  it("mostra o saldo estimado e diz que é estimativa", () => {
    expect(describeAccountBalance(account({ estimatedBalance: 27.5, informed: 40, spentSince: 12.5, exceeded: false, currency: "BRL", since: "2026-10-13", entries: [] })))
      .toMatchObject({ text: expect.stringMatching(/R\$\s27,50/), tone: "ok", detail: expect.stringMatching(/estimado/) });
  });
  it("gasto acima do informado vira alerta", () => {
    expect(describeAccountBalance(account({ estimatedBalance: 0, informed: 40, spentSince: 55, exceeded: true, currency: "BRL", since: "2026-10-13", entries: [] })).tone).toBe("warn");
  });
});
