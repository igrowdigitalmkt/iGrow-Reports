import { describe, expect, it } from "vitest";
import { buildClientOverview, rankCampaigns, type OverviewGoogleSection } from "@/modules/client-portal/client-overview";
import { googleAccountBilling as billingOf } from "@/modules/google-ads/billing";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";

const day = (date: string, spend: number) => ({ date, values: { spend } });
function data(partial: Partial<AnalyticsDashboardData>): AnalyticsDashboardData {
  return { accounts: [], selectedAccountIds: [], summary: {}, previousSummary: {}, daily: [], previousDaily: [], accountTotals: [], campaigns: [], ...partial } as unknown as AnalyticsDashboardData;
}
const account = (id: string, currency = "BRL") => ({ id, name: `Conta ${id}`, externalId: `act_${id}`, currency, timezoneName: "America/Sao_Paulo" });
const meta = (overrides: Partial<AnalyticsDashboardData> = {}) => data({
  accounts: [account("m1"), account("m2")], selectedAccountIds: ["m1", "m2"],
  accountTotals: [{ id: "m1", name: "Conta m1", currency: "BRL", values: { spend: 100 } }, { id: "m2", name: "Conta m2", currency: "BRL", values: { spend: 50 } }],
  previousSummary: { spend: 120 }, daily: [day("2026-10-01", 80), day("2026-10-02", 70)], previousDaily: [day("2026-09-29", 60), day("2026-09-30", 60)],
  campaigns: [
    { id: "c1", name: "Camp A", accountName: "Conta m1", accountId: "m1", currency: "BRL", status: "ACTIVE", values: { spend: 100 } },
    { id: "c2", name: "Camp B", accountName: "Conta m2", accountId: "m2", currency: "BRL", status: "ACTIVE", values: { spend: 50 } },
  ], ...overrides,
});
const google = (spend: number, currency = "BRL"): OverviewGoogleSection => ({ id: "g1", name: "Google 1", data: data({
  currency, summary: { spend }, previousSummary: { spend: 30 }, daily: [day("2026-10-01", spend / 2), day("2026-10-02", spend / 2)], previousDaily: [day("2026-09-29", 15), day("2026-09-30", 15)],
  campaigns: [{ id: "gc", name: "Search", accountName: "Google 1", accountId: "g1", currency, status: "ENABLED", values: { spend } }],
}) });

describe("visão geral do cliente em todas as plataformas", () => {
  it("soma Meta e Google quando a moeda é a mesma, com série diária e período anterior combinados", () => {
    const overview = buildClientOverview(meta(), [google(40)]);
    expect(overview.currency).toBe("BRL");
    expect(overview.spend).toBe(190);
    expect(overview.previousSpend).toBe(150);
    expect(overview.days).toEqual(["2026-10-01", "2026-10-02"]);
    expect(overview.trend).toEqual([100, 90]);
    expect(overview.previousTrend).toEqual([75, 75]);
    expect(overview.platformCounts).toEqual({ meta: 2, google: 1 });
    expect(overview.accounts.map(item => item.platform)).toEqual(["meta", "meta", "google"]);
  });
  it("não soma moedas diferentes nem inventa totais", () => {
    const overview = buildClientOverview(meta(), [google(40, "USD")]);
    expect(overview.currency).toBeNull();
    expect(overview.spend).toBeNull();
    expect(overview.previousSpend).toBeNull();
    expect(overview.days).toEqual([]);
  });
  it("conta sem dado confirmado deixa o total vazio, não zero", () => {
    const overview = buildClientOverview(meta({ accountTotals: [{ id: "m1", name: "Conta m1", currency: "BRL", values: { spend: 100 } }] }), []);
    expect(overview.accounts.find(item => item.id === "m2")?.spend).toBeNull();
    expect(overview.spend).toBeNull();
  });
  it("série diária por conta só quando a Meta tem uma única conta selecionada", () => {
    expect(buildClientOverview(meta(), []).accounts[0]!.trend).toEqual([]);
    const single = buildClientOverview(meta({ selectedAccountIds: ["m1"] }), []);
    expect(single.accounts[0]!.trend).toEqual([80, 70]);
  });
  it("principais campanhas: só as que gastaram, em ordem, nas duas plataformas", () => {
    const overview = buildClientOverview(meta(), [google(500)], null, 2);
    expect(overview.campaigns.map(item => item.name)).toEqual(["Search", "Camp A"]);
    expect(overview.campaigns[0]!.platform).toBe("google");
  });
  it("campanhas: ativas primeiro (mesmo sem gasto), depois as com gasto no período; parada sem gasto fica de fora", () => {
    const ranked = rankCampaigns([
      { name: "parada sem gasto", active: false, spend: 0 },
      { name: "pausada com gasto", active: false, spend: 300 },
      { name: "ativa sem gasto", active: true, spend: 0 },
      { name: "ativa com gasto", active: true, spend: 10 },
      { name: "pausada com menos gasto", active: false, spend: 20 },
    ]);
    expect(ranked.map(item => item.name)).toEqual(["ativa com gasto", "ativa sem gasto", "pausada com gasto", "pausada com menos gasto"]);
  });
  it("Meta ao vivo: campanha ativa sem gasto entra antes das pausadas, com o estado real", () => {
    const state = (group: string, label: string) => ({ label, tone: "neutral" as const, group, restriction: group === "active" ? "Conta sem veiculação" : null });
    const live = [
      { id: "p", accountId: "m1", name: "Pausada com gasto", accountName: "Conta m1", currency: "BRL", values: { spend: 90 }, state: state("paused", "Pausado") },
      { id: "a", accountId: "m1", name: "Ativa sem gasto", accountName: "Conta m1", currency: "BRL", values: { spend: null }, state: state("active", "Ativo") },
      { id: "x", accountId: "other", name: "Outra conta", accountName: "Outra", currency: "BRL", values: { spend: 999 }, state: state("active", "Ativo") },
    ];
    const rows = buildClientOverview(meta(), [], live).campaigns;
    expect(rows.map(item => item.name)).toEqual(["Ativa sem gasto", "Pausada com gasto"]);
    expect(rows[0]).toMatchObject({ active: true, spend: null, state: { label: "Ativo", restriction: "Conta sem veiculação" } });
    // sem a leitura ao vivo a situação não é inventada
    expect(buildClientOverview(meta(), []).campaigns.every(item => item.state === null && !item.active)).toBe(true);
  });
  it("ordem padrão: em veiculação, depois ativas, depois as mais recentes", () => {
    const rows = rankCampaigns([
      { name: "ativa antiga", active: true, tier: 1 as const, createdAt: "2026-01-01T00:00:00+0000", spend: 500 },
      { name: "em veiculação antiga", active: true, tier: 0 as const, createdAt: "2026-02-01T00:00:00+0000", spend: 1 },
      { name: "em veiculação nova", active: true, tier: 0 as const, createdAt: "2026-09-01T00:00:00+0000", spend: 1 },
      { name: "ativa nova", active: true, tier: 1 as const, createdAt: "2026-10-01T00:00:00+0000", spend: 1 },
      { name: "ativa sem data", active: true, tier: 1 as const, createdAt: null, spend: 9999 },
      { name: "pausada com gasto", active: false, tier: 2 as const, createdAt: "2026-10-10T00:00:00+0000", spend: 70 },
    ]);
    expect(rows.map(item => item.name)).toEqual(["em veiculação nova", "em veiculação antiga", "ativa nova", "ativa antiga", "ativa sem data", "pausada com gasto"]);
  });
  it("só entram as contas selecionadas da Meta", () => {
    const overview = buildClientOverview(meta({ selectedAccountIds: ["m2"] }), []);
    expect(overview.accounts.map(item => item.id)).toEqual(["m2"]);
    expect(overview.spend).toBe(50);
    expect(overview.campaigns.map(item => item.id)).toEqual(["c2"]);
  });
});

// As fontes que não são o assunto do teste ficam vazias.
const googleAccountBilling = (input: { id: string; name: string; currency: string; customerRow: unknown; budgetRows: unknown[] | null }) => billingOf({
  id: input.id, name: input.name, currency: input.currency, customerRow: input.customerRow, accountBudgetRows: input.budgetRows,
  billingSetupRows: null, monthCostRows: null, campaignBudgetRows: null, probes: [],
});

describe("situação e limite das contas do Google Ads", () => {
  const base = { id: "g1", name: "Google 1", currency: "BRL" };
  it("estado da conta vira rótulo e entrega; sem orçamento da conta não há limite inventado", () => {
    const row = googleAccountBilling({ ...base, customerRow: { customer: { status: "ENABLED", currencyCode: "BRL" } }, budgetRows: [] });
    expect(row).toMatchObject({ platform: "google", delivering: true, statusLabel: "Ativa", spendCap: null, amountSpent: null, balanceDue: null, availableBalance: null });
    const suspended = googleAccountBilling({ ...base, customerRow: { customer: { status: "SUSPENDED" } }, budgetRows: null });
    expect(suspended).toMatchObject({ delivering: false, statusLabel: "Suspensa" });
  });
  it("orçamento aprovado da conta vira limite e gasto (valores em micros)", () => {
    const row = googleAccountBilling({ ...base, customerRow: { customer: { status: "ENABLED" } }, budgetRows: [
      { accountBudget: { status: "APPROVED", approvedSpendingLimitMicros: "1000000000", amountServedMicros: "250000000" } },
    ] });
    expect(row).toMatchObject({ spendCap: 1000, amountSpent: 250, fundingLabel: "Orçamento da conta" });
  });
  it("estado desconhecido não é tratado como ativo", () => {
    expect(googleAccountBilling({ ...base, customerRow: undefined, budgetRows: null })).toMatchObject({ delivering: false, statusLabel: "Situação desconhecida" });
  });
});

describe("tudo o que a API do Google Ads informa de pagamento e gasto", () => {
  const base = { id: "g1", name: "Google 1", currency: "BRL", customerRow: { customer: { status: "ENABLED", currencyCode: "BRL" } }, accountBudgetRows: [] as unknown[] | null, billingSetupRows: [] as unknown[] | null, monthCostRows: [] as unknown[] | null, campaignBudgetRows: [] as unknown[] | null, probes: [] };
  it("gasto do mês soma as linhas; sem leitura fica vazio, nunca zero", () => {
    expect(billingOf({ ...base, monthCostRows: [{ metrics: { costMicros: "1500000" } }, { metrics: { costMicros: "2500000" } }] }).google?.monthSpend).toBeCloseTo(4);
    expect(billingOf({ ...base, monthCostRows: null }).google?.monthSpend).toBeNull();
  });
  it("orçamento total de campanha: definido, gasto e o que resta; orçamento diário só das campanhas sem total", () => {
    const row = billingOf({ ...base, campaignBudgetRows: [
      { campaign: { id: "1", name: "Teste de dados" }, campaignBudget: { amountMicros: "0", totalAmountMicros: "40000000" }, metrics: { costMicros: "12500000" } },
      { campaign: { id: "2", name: "Diária" }, campaignBudget: { amountMicros: "10000000" }, metrics: { costMicros: "999" } },
      { campaign: { id: "3", name: "Outra diária" }, campaignBudget: { amountMicros: "5000000" }, metrics: {} },
    ] }).google!;
    expect(row.totalBudgets).toEqual([{ id: "1", name: "Teste de dados", total: 40, spent: 12.5, remaining: 27.5 }]);
    expect(row.dailyBudget).toBeCloseTo(15);
  });
  it("gasto acima do orçamento total nunca gera saldo negativo", () => {
    expect(billingOf({ ...base, campaignBudgetRows: [{ campaign: { id: "1", name: "A" }, campaignBudget: { totalAmountMicros: "10000000" }, metrics: { costMicros: "12000000" } }] }).google?.totalBudgets[0]).toMatchObject({ remaining: 0 });
  });
  it("faturamento mensal: cobrança e conta de pagamentos aparecem; sem isso a conta não é tratada como faturada", () => {
    const invoiced = billingOf({ ...base, billingSetupRows: [{ billingSetup: { status: "APPROVED", paymentsAccountInfo: { paymentsAccountId: "1111-2222", paymentsAccountName: "iGrow" } } }] });
    expect(invoiced.google).toMatchObject({ invoiced: true, paymentsAccount: { id: "1111-2222", name: "iGrow" } });
    expect(invoiced.fundingLabel).toBe("Faturamento mensal");
    expect(billingOf(base).google).toMatchObject({ invoiced: false, paymentsAccount: null });
  });
  it("as fontes consultadas viajam junto, com o que cada uma devolveu", () => {
    const probes = [{ source: "cobrança da conta", state: "error" as const, message: "sem permissão" }];
    expect(billingOf({ ...base, probes }).google?.probes).toEqual(probes);
  });
});
