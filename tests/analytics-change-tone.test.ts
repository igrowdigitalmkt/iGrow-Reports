import { describe, expect, it } from "vitest";
import { changeDescription, desirableDirection } from "@/modules/client-portal/analytics-comparison";
import type { AnalyticsDashboardData, AnalyticsMetric } from "@/modules/client-portal/analytics-types";

const metric = (key: string, label: string, desirable: AnalyticsMetric["desirable"] = "up"): AnalyticsMetric => ({ key, label, unit: "integer", precision: 0, desirable });
const data = (current: number, previous: number, key: string) => ({
  coverage: { status: "complete", previousStatus: "complete" }, summary: { [key]: current }, previousSummary: { [key]: previous },
}) as unknown as AnalyticsDashboardData;

describe("cor da variação: depende de a métrica ser boa ao subir ou ao cair", () => {
  it("custos, CPM e CPC: subir é ruim (vermelho), cair é bom (verde)", () => {
    for (const [key, label] of [["cpm", "CPM"], ["cpc_link", "CPC"], ["cost_per_result", "Custo por resultado"], ["cost:action:lead", "Custo por lead"], ["cpp", "CPP"]] as const) {
      // mesmo se o dado guardado vier como "neutral" ou "up", a regra por nome vale
      expect(changeDescription(data(150, 100, key), metric(key, label, "up")).direction, `${key} sobe`).toBe("negative");
      expect(changeDescription(data(70, 100, key), metric(key, label, "neutral")).direction, `${key} cai`).toBe("positive");
    }
  });
  it("frequência é neutra: nunca verde nem vermelho", () => {
    for (const desirable of ["up", "down", "neutral"] as const) {
      expect(changeDescription(data(150, 100, "frequency"), metric("frequency", "Frequência", desirable))).toMatchObject({ direction: "neutral", up: true });
      expect(changeDescription(data(70, 100, "frequency"), metric("frequency", "Frequência", desirable))).toMatchObject({ direction: "neutral", up: false });
    }
  });
  it("resultados, alcance, impressões, cliques e CTR: subir é bom, cair é ruim", () => {
    for (const [key, label] of [["primary_results", "Resultados"], ["reach", "Alcance"], ["impressions", "Impressões"], ["link_clicks", "Cliques no link"], ["ctr_link", "CTR"]] as const) {
      expect(changeDescription(data(150, 100, key), metric(key, label)).direction).toBe("positive");
      expect(changeDescription(data(70, 100, key), metric(key, label)).direction).toBe("negative");
    }
  });
  it("impressões, cliques e ações contam como bons ao subir mesmo se o dado guardado os marcou como indiferentes", () => {
    for (const [key, label] of [["impressions", "Impressões"], ["reach", "Alcance"], ["link_clicks", "Cliques no link"], ["action:landing_page_view", "Visualizações da página"], ["inline_post_engagement", "Engajamento"], ["video_views", "Visualizações de vídeo"]] as const) {
      expect(changeDescription(data(150, 100, key), metric(key, label, "neutral")).direction, key).toBe("positive");
    }
  });
  it("investimento é indiferente: nunca verde nem vermelho, mas a seta segue o sentido do número", () => {
    const up = changeDescription(data(695, 100, "spend"), metric("spend", "Valor usado", "neutral"));
    expect(up).toMatchObject({ direction: "neutral", up: true });
    expect(changeDescription(data(10, 100, "spend"), metric("spend", "Valor usado", "neutral"))).toMatchObject({ direction: "neutral", up: false });
  });
  it("sem variação ou sem comparação continua neutro", () => {
    expect(changeDescription(data(100, 100, "cpm"), metric("cpm", "CPM", "down")).direction).toBe("neutral");
    expect(changeDescription({ ...data(1, 2, "cpm"), coverage: { status: "partial", previousStatus: "complete" } } as unknown as AnalyticsDashboardData, metric("cpm", "CPM", "down")).direction).toBe("neutral");
  });
  it("sentido desejável: o investimento não é nem bom nem ruim; o resto segue a métrica", () => {
    expect(desirableDirection(metric("spend", "Valor usado", "up"))).toBe("neutral");
    expect(desirableDirection(metric("custom", "Visualizações", "up"))).toBe("up");
    expect(desirableDirection(metric("custom_cost", "Qualquer", "up"))).toBe("down");
    expect(desirableDirection(metric("x", "Custo por clique", "neutral"))).toBe("down");
  });
});
