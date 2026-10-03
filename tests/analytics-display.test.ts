import { describe, expect, it } from "vitest";
import { changeDescription } from "@/modules/client-portal/analytics-comparison";
import { reconcileHierarchySelection } from "@/modules/client-portal/analytics-selection";
import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import type { AnalyticsMetric } from "@/modules/client-portal/analytics-types";

const entity = (id: string, level: AnalyticsEntity["level"] = "campaign", parentId: string | null = null, campaignId = id): AnalyticsEntity => ({
  key: `${level}:${id}`, id, level, name: id, parentId, campaignId, accountId: "a", accountName: "Conta", currency: "BRL", values: {},
});
describe("comparação e seleção do dashboard", () => {
  const cost: AnalyticsMetric = { key: "cpc", label: "CPC", unit: "currency", desirable: "down", precision: 2 };
  const comparison = (current: number | null, previous: number | null) => normalizeClientAnalytics({
    summary: { cpc: current }, previousSummary: { cpc: previous }, coverage: { status: "complete", previousStatus: "complete" },
  });
  it("usa verde para aumento e vermelho para redução inclusive em custos", () => {
    expect(changeDescription(comparison(20, 10), cost)).toMatchObject({ direction: "positive", up: true, text: "+100% vs. anterior" });
    expect(changeDescription(comparison(5, 10), cost)).toMatchObject({ direction: "negative", up: false, text: "-50% vs. anterior" });
  });
  it("mantém comparação sem base, desconhecida e arredondada como neutra", () => {
    expect(changeDescription(comparison(0, 0), cost).direction).toBe("neutral");
    expect(changeDescription(comparison(10, 0), cost).text).toBe("Anterior igual a zero");
    expect(changeDescription(comparison(null, 10), cost).text).toBe("Comparação indisponível");
    expect(changeDescription(comparison(100.01, 100), cost).direction).toBe("neutral");
  });
  it("não compara um total com objetivos diferentes", () => {
    const data = normalizeClientAnalytics({ summary: { "result:provider_known": 1, "result:provider:action:lead": 10,
      "result:provider:instagram_profile_visits": 20 }, previousSummary: { "result:provider_known": 1, "result:provider:action:lead": 5 },
      coverage: { status: "complete", previousStatus: "complete" } });
    expect(changeDescription(data, { ...cost, key: "primary_results", desirable: "up" }).text).toBe("Resultados com tipos diferentes");
  });
  it("mantém a base zero para o mesmo tipo de resultado", () => {
    const data = normalizeClientAnalytics({ summary: { "result:provider_known": 1, "result:provider:action:lead": 10 },
      previousSummary: { "result:provider_known": 1, "result:provider:action:lead": 0 },
      coverage: { status: "complete", previousStatus: "complete" } });
    expect(changeDescription(data, { ...cost, key: "primary_results", desirable: "up" }).text).toBe("Anterior igual a zero");
  });
  it("mantém seleção completa ao entrar uma campanha e novos anúncios", () => {
    const previous = [entity("c")], next = [entity("c"), entity("s", "adset", "c", "c"), entity("d", "ad", "s", "c"), entity("new")];
    expect(reconcileHierarchySelection({ previous, next, selectedLeaves: ["campaign:c"], appliedEntityKeys: ["campaign:c"], unrestricted: true }))
      .toEqual({ selectedLeaves: ["ad:d", "campaign:new"], appliedEntityKeys: ["campaign:c", "campaign:new"] });
  });
  it("conserva pais selecionados parcialmente quando passam a ter novos filhos", () => {
    const previous = [entity("c"), entity("other")], next = [...previous, entity("s", "adset", "c", "c"), entity("d", "ad", "s", "c")];
    expect(reconcileHierarchySelection({ previous, next, selectedLeaves: ["campaign:c"], appliedEntityKeys: ["campaign:c"], unrestricted: false }))
      .toEqual({ selectedLeaves: ["ad:d"], appliedEntityKeys: ["campaign:c"] });
  });
  it("preserva anúncio individual sem selecionar seus novos irmãos", () => {
    const previous = [entity("c"), entity("s", "adset", "c", "c"), entity("a", "ad", "s", "c"), entity("b", "ad", "s", "c")];
    const next = [...previous, entity("new", "ad", "s", "c")];
    expect(reconcileHierarchySelection({ previous, next, selectedLeaves: ["ad:a"], appliedEntityKeys: ["ad:a"], unrestricted: false }))
      .toEqual({ selectedLeaves: ["ad:a"], appliedEntityKeys: ["ad:a"] });
  });
  it("não troca silenciosamente o escopo aplicado quando a fonte desaparece", () => {
    expect(reconcileHierarchySelection({ previous: [entity("old"), entity("other")], next: [entity("other")],
      selectedLeaves: ["campaign:old"], appliedEntityKeys: ["campaign:old"], unrestricted: false }))
      .toEqual({ selectedLeaves: [], appliedEntityKeys: ["campaign:old"] });
  });
});
