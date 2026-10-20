import { describe, expect, it } from "vitest";
import { buildClientOverview, rankCampaigns, type OverviewGoogleSection } from "@/modules/client-portal/client-overview";
import { googleAccountBilling } from "@/modules/google-ads/billing";
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
    const overview = buildClientOverview(meta(), [google(500)], 2);
    expect(overview.campaigns.map(item => item.name)).toEqual(["Search", "Camp A"]);
    expect(overview.campaigns[0]!.platform).toBe("google");
  });
  it("campanhas: ativas primeiro (mesmo sem gasto), depois as com gasto no período; parada sem gasto fica de fora", () => {
    const ranked = rankCampaigns([
      { name: "parada sem gasto", status: "PAUSED", spend: 0 },
      { name: "pausada com gasto", status: "PAUSED", spend: 300 },
      { name: "ativa sem gasto", status: "ENABLED", spend: 0 },
      { name: "ativa com gasto", status: "ACTIVE", spend: 10 },
      { name: "pausada com menos gasto", status: "PAUSED", spend: 20 },
    ]);
    expect(ranked.map(item => item.name)).toEqual(["ativa com gasto", "ativa sem gasto", "pausada com gasto", "pausada com menos gasto"]);
  });
  it("só entram as contas selecionadas da Meta", () => {
    const overview = buildClientOverview(meta({ selectedAccountIds: ["m2"] }), []);
    expect(overview.accounts.map(item => item.id)).toEqual(["m2"]);
    expect(overview.spend).toBe(50);
    expect(overview.campaigns.map(item => item.id)).toEqual(["c2"]);
  });
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
