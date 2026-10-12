import { describe, expect, it } from "vitest";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import { buildReportFacts, percentChange } from "@/modules/reports/report-facts";

const MESSAGES = "result:provider:action:onsite_conversion.messaging_conversation_started_7d";
const VISITS = "result:provider:instagram_profile_visits";
const ENGAGEMENT = "result:provider:action:post_engagement";

function data(overrides: Partial<AnalyticsDashboardData> = {}): AnalyticsDashboardData {
  return {
    dateFrom: "2026-09-12", dateTo: "2026-10-10", previousDateFrom: "2026-08-14", previousDateTo: "2026-09-11",
    currency: "BRL", timezoneName: "America/Sao_Paulo", primaryMetricKey: null, primaryActionType: null,
    accounts: [], selectedAccountIds: ["a", "b"],
    summary: { spend: 3649.69, impressions: 265590, reach: 128504, cpm: 13.74, link_clicks: 5000, "result:provider_known": 1, [MESSAGES]: 201, [VISITS]: 4162, [ENGAGEMENT]: 30583 },
    previousSummary: { spend: 4783.2, impressions: 314308, reach: 126480, cpm: 15.22, link_clicks: 4000, "result:provider_known": 1, [MESSAGES]: 180, [VISITS]: 5000, [ENGAGEMENT]: 20000 },
    daily: [], previousDaily: [],
    accountTotals: [
      { id: "a", name: "RM Imobiliária", currency: "BRL", values: { spend: 0 } },
      { id: "b", name: "Ronaldo Moreira", currency: "BRL", values: { spend: 3649.69 } },
    ],
    campaigns: [
      { id: "c1", name: "Mensagens", accountName: "Ronaldo Moreira", accountId: "b", currency: "BRL", status: null, values: { spend: 2613, "result:provider_known": 1, [MESSAGES]: 201 } },
      { id: "c2", name: "Perfil", accountName: "Ronaldo Moreira", accountId: "b", currency: "BRL", status: null, values: { spend: 707.54, "result:provider_known": 1, [VISITS]: 4162 } },
      { id: "c3", name: "Engajamento", accountName: "Ronaldo Moreira", accountId: "b", currency: "BRL", status: null, values: { spend: 329.15, "result:provider_known": 1, [ENGAGEMENT]: 30583 } },
    ],
    metrics: [],
    coverage: { status: "complete", previousStatus: "complete", latestCollectedAt: null, coveredDays: 29, previousCoveredDays: 29, totalDays: 29 },
    warnings: [],
    ...overrides,
  };
}

describe("fatos do relatório", () => {
  it("calcula variações, frequência e quantidades por tipo contra o período anterior", () => {
    const facts = buildReportFacts(data());
    expect(facts.period.comparable).toBe(true);
    expect(facts.spend.changePct).toBeCloseTo(-23.7, 1);
    expect(facts.delivery.reach.changePct).toBeCloseTo(1.6, 1);
    expect(facts.delivery.frequency.current).toBeCloseTo(2.067, 3);
    expect(facts.delivery.frequency.previous).toBeCloseTo(2.485, 3);
    const messages = facts.results.find(result => result.label.startsWith("Conversas"));
    expect(messages).toMatchObject({ quantity: 201, previousQuantity: 180 });
    expect(messages?.changePct).toBeCloseTo(11.67, 1);
  });

  it("usa só o investimento das campanhas de cada tipo, não o total dividido", () => {
    const facts = buildReportFacts(data());
    const messages = facts.results.find(result => result.label.startsWith("Conversas"));
    expect(messages?.costPerResult).toBeCloseTo(13, 5);
    expect(messages?.spend).toBeCloseTo(2613, 5);
    expect(3649.69 / 201).toBeGreaterThan(18);
  });

  it("ordena campanhas por investimento e indica a participação", () => {
    const facts = buildReportFacts(data());
    expect(facts.campaigns.map(campaign => campaign.name)).toEqual(["Mensagens", "Perfil", "Engajamento"]);
    expect(facts.campaigns[0]?.shareOfSpend).toBeCloseTo(71.6, 1);
    expect(facts.campaigns[0]?.costPerResult).toBeCloseTo(13, 5);
  });

  it("não inventa comparação sem cobertura completa e avisa o limite", () => {
    const facts = buildReportFacts(data({ coverage: { ...data().coverage, previousStatus: "partial" } }));
    expect(facts.period.comparable).toBe(false);
    expect(facts.spend.previous).toBeNull();
    expect(facts.spend.changePct).toBeNull();
    expect(facts.results.every(result => result.previousQuantity === null && result.changePct === null)).toBe(true);
    expect(facts.limitations.join(" ")).toContain("Sem comparação");
  });

  it("marca alcance estimado com mais de uma conta e preserva conta sem gasto", () => {
    const facts = buildReportFacts(data());
    expect(facts.delivery.reachEstimated).toBe(true);
    expect(facts.accounts).toEqual([
      { name: "RM Imobiliária", spend: 0, shareOfSpend: 0 },
      { name: "Ronaldo Moreira", spend: 3649.69, shareOfSpend: expect.closeTo(100, 5) },
    ]);
  });

  it("deixa o custo nulo quando as campanhas não conciliam com o total", () => {
    const base = data();
    const facts = buildReportFacts({ ...base, campaigns: base.campaigns.slice(0, 2) });
    expect(facts.results.every(result => result.costPerResult === null)).toBe(true);
    expect(facts.limitations.join(" ")).toContain("conciliado");
  });

  it("avisa quando a lista de campanhas é só uma parte das que tiveram investimento", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `Campanha ${i}`, accountName: "Conta", accountId: "b", currency: "BRL", status: null, values: { spend: 10 + i } }));
    const facts = buildReportFacts({ ...data(), campaigns: many });
    expect(facts.campaigns).toHaveLength(10);
    expect(facts.campaignsWithSpend).toBe(12);
    expect(facts.limitations.join(" ")).toContain("só as 10 de maior investimento, de 12");
    expect(buildReportFacts(data()).campaignsWithSpend).toBe(3);
  });

  it("compara o custo por resultado com o período anterior quando as campanhas anteriores são fornecidas", () => {
    const previous: AnalyticsEntity[] = [{ key: "campaign:p1", id: "p1", level: "campaign", name: "Mensagens", parentId: null, campaignId: null, accountId: "b", accountName: "Conta", currency: "BRL", values: { spend: 2700, "result:provider_known": 1, [MESSAGES]: 180 } }];
    const facts = buildReportFacts(data(), undefined, previous);
    const messages = facts.results.find(result => result.label.startsWith("Conversas"));
    expect(messages?.previousCostPerResult).toBeNull();
    const reconciled = buildReportFacts({ ...data(), previousSummary: { ...data().previousSummary, spend: 2700, [VISITS]: 0, [ENGAGEMENT]: 0 } }, undefined, previous);
    const m = reconciled.results.find(result => result.label.startsWith("Conversas"));
    expect(m?.previousCostPerResult).toBeCloseTo(15, 5);
    expect(m?.costChangePct).toBeCloseTo(-13.33, 1);
    expect(reconciled.limitations.join(" ")).not.toContain("período anterior não está disponível");
  });

  it("lista os anúncios de maior investimento com o custo do único tipo de resultado", () => {
    const ad = (id: string, spend: number, quantity: number): AnalyticsEntity => ({ key: `ad:${id}`, id, level: "ad", name: `Anúncio ${id}`, parentId: "s1", campaignId: "c1", accountId: "b", accountName: "Conta", currency: "BRL", values: { spend, "result:provider_known": 1, [MESSAGES]: quantity } });
    const campaign: AnalyticsEntity = { key: "campaign:c1", id: "c1", level: "campaign", name: "Mensagens", parentId: null, campaignId: null, accountId: "b", accountName: "Conta", currency: "BRL", values: { spend: 2613, "result:provider_known": 1, [MESSAGES]: 201 } };
    const entities = [campaign, ...Array.from({ length: 7 }, (_, i) => ad(String(i), 100 + i, 10 + i))];
    const facts = buildReportFacts(data(), entities);
    expect(facts.ads).toHaveLength(5);
    expect(facts.adsWithSpend).toBe(7);
    expect(facts.ads[0]).toMatchObject({ name: "Anúncio 6", campaignName: "Mensagens" });
    expect(facts.ads[0]?.costPerResult).toBeCloseTo(106 / 16, 5);
    expect(facts.limitations.join(" ")).toContain("só os 5 de maior investimento, de 7");
  });

  it("não trata divisão por zero nem valor ausente como variação", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
    expect(percentChange(5, Number.NaN)).toBeNull();
    expect(percentChange(110, 100)).toBeCloseTo(10, 5);
  });
});
