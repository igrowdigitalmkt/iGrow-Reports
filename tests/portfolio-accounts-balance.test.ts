import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/billing/guard", () => ({ ensurePaidOperation: async () => undefined, paidOperationBlock: async () => null, billingBlockOf: () => null, BillingRestrictedError: class extends Error {} }));
import { describeAccountBalance } from "@/modules/meta/balance";
import { googleAccountsByClient } from "@/modules/google-ads/provider";
import type { ClientAccountBilling } from "@/modules/meta/server";

const account = (over: Partial<ClientAccountBilling>): ClientAccountBilling => ({
  accountId: "a", name: "Conta", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: false, fundingLabel: null,
  amountSpent: null, spendCap: null, balanceDue: null, availableBalance: null, ...over,
});

describe("saldo e pagamento de cada conta", () => {
  it("pagamento pendente mostra o valor a pagar da PRÓPRIA conta", () => {
    expect(describeAccountBalance(account({ delivering: false, statusLabel: "Pagamento pendente", balanceDue: 1234.03 }))).toMatchObject({ text: "Pagamento pendente", tone: "warn", detail: expect.stringMatching(/R\$\s1\.234,03 a pagar/) });
  });
  it("conta pré-paga mostra o saldo; limite de gastos mostra o que resta, sem misturar contas", () => {
    expect(describeAccountBalance(account({ prepaid: true, availableBalance: 122.13 }))).toMatchObject({ text: expect.stringMatching(/R\$\s122,13/), tone: "ok", detail: "saldo pré-pago" });
    expect(describeAccountBalance(account({ spendCap: 1000, amountSpent: 250 }))).toMatchObject({ text: expect.stringMatching(/R\$\s750,00/), detail: "limite restante" });
    expect(describeAccountBalance(account({ prepaid: true, availableBalance: 0 })).tone).toBe("warn");
  });
  it("pós-pago sem limite é cartão; sem informação, nada é inventado", () => {
    expect(describeAccountBalance(account({}))).toMatchObject({ text: "Cartão (pós-pago)", tone: "muted" });
    expect(describeAccountBalance(account({ prepaid: true }))).toMatchObject({ text: "Sem saldo informado", tone: "muted" });
  });
  it("Google Ads não informa saldo de cartão: só o estado da conta, sem 'pagamento pendente' inventado", () => {
    expect(describeAccountBalance(account({ platform: "google", statusLabel: "Ativa" }))).toMatchObject({ text: "Ativa", tone: "muted", detail: "crédito da conta não informado pelo Google" });
    expect(describeAccountBalance(account({ platform: "google", delivering: false, statusLabel: "Suspensa" }))).toMatchObject({ text: "Suspensa", tone: "warn" });
  });
});

describe("contas do Google Ads por cliente", () => {
  const service = (links: unknown[], accounts: unknown[]) => ({
    from: (table: string) => {
      const data = table === "client_google_accounts" ? links : accounts;
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is"]) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => void) => resolve({ data, error: null });
      return chain;
    },
  }) as never;
  it("agrupa por cliente só as contas ativas e não arquivadas, mesmo sem investimento", async () => {
    const result = await googleAccountsByClient(service(
      [{ client_id: "c1", google_ad_account_id: "g1" }, { client_id: "c1", google_ad_account_id: "g2" }, { client_id: "c2", google_ad_account_id: "g3" }],
      [{ id: "g1", name: "Conta 1" }, { id: "g2", name: "Conta 2" }],
    ), "agency");
    expect(result).toEqual({ c1: [{ id: "g1", name: "Conta 1" }, { id: "g2", name: "Conta 2" }] });
  });
  it("sem vínculos devolve vazio", async () => {
    expect(await googleAccountsByClient(service([], []), "agency")).toEqual({});
  });
});

describe("rótulos de métricas sem texto guardado", () => {
  it("custo de ação personalizada nunca mostra o código bruto", async () => {
    const { metaMetricLabel } = await import("@/modules/meta/metric-labels");
    const key = "cost:action:offsite_complete_registration_add_meta_leads";
    for (const fallback of [key, `Custo por ${key}`, "Custo por action:offsite_complete_registration_add_meta_leads"]) {
      const label = metaMetricLabel(key, fallback);
      expect(label).not.toMatch(/cost:|action:|_/);
      expect(label).toMatch(/^Custo por cadastro concluído/);
    }
    expect(metaMetricLabel("value:action:offsite_purchase_add_meta_leads", "value:action:offsite_purchase_add_meta_leads")).not.toMatch(/value:|action:|_/);
  });
  it("rótulos conhecidos e guardados continuam como antes", async () => {
    const { metaMetricLabel } = await import("@/modules/meta/metric-labels");
    expect(metaMetricLabel("cost:action:lead", "Custo por leads")).toBe("Custo por leads");
    expect(metaMetricLabel("cost:action:complete_registration", "Custo por cadastros concluídos")).toBe("Custo por cadastros concluídos");
    expect(metaMetricLabel("cpm", "CPM")).toBe("CPM (custo por 1.000 impressões)");
  });
});

describe("saldo do Google pelos orçamentos totais das campanhas", () => {
  it("sem saldo da conta, mostra o que resta nos orçamentos totais definidos e diz de onde vem", () => {
    const line = describeAccountBalance(account({ platform: "google", google: { monthSpend: 3, dailyBudget: null, hasBillingSetup: false, paymentsAccount: null, probes: [],
      totalBudgets: [{ id: "1", name: "Teste", total: 40, spent: 10, remaining: 30 }, { id: "2", name: "Outra", total: 20, spent: 20, remaining: 0 }] } }));
    expect(line).toMatchObject({ text: expect.stringMatching(/R\$\s30,00/), tone: "ok", detail: "restante nos orçamentos totais das campanhas" });
  });
  it("sem orçamento total, continua dizendo que o crédito da conta não é informado", () => {
    expect(describeAccountBalance(account({ platform: "google" }))).toMatchObject({ tone: "muted", detail: "crédito da conta não informado pelo Google" });
  });
});
