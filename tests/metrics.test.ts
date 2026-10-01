import { describe, expect, it } from "vitest";
import {
  calculateDerivedMetrics,
  calculateVariation,
  compareDirection,
  safeDivide,
  sumDecimal,
} from "@/modules/metrics/calculations";

describe("motor de métricas", () => {
  it("recalcula índices a partir dos totais do mesmo escopo", () => {
    const result = calculateDerivedMetrics({
      spend: "250",
      impressions: "25000",
      linkClicks: "250",
      primaryResults: "25",
      attributedRevenue: "1000",
    });
    expect(result.ctrLink).toBe("1");
    expect(result.cpcLink).toBe("1");
    expect(result.cpm).toBe("10");
    expect(result.costPerResult).toBe("10");
    expect(result.roas).toBe("4");
  });

  it("não produz infinito em divisões por zero", () => {
    expect(safeDivide("10", "0")).toBeNull();
    const result = calculateDerivedMetrics({
      spend: "0",
      impressions: "0",
      linkClicks: "0",
      primaryResults: "0",
      attributedRevenue: "0",
    });
    expect(result.ctrLink).toBeNull();
    expect(result.cpcLink).toBeNull();
    expect(result.cpm).toBeNull();
    expect(result.costPerResult).toBeNull();
    expect(result.roas).toBeNull();
  });

  it("preserva precisão decimal antes da exibição", () => {
    expect(safeDivide("1", "3")).toBe("0.33333333333333333333");
    expect(sumDecimal(["0.1", "0.2", "0.3"])).toBe("0.6");
  });

  it("diferencia ausência de base de comparação", () => {
    expect(calculateVariation("10", "0")).toEqual({
      status: "no_base",
      value: null,
    });
    expect(calculateVariation(null, "10")).toEqual({
      status: "unavailable",
      value: null,
    });
  });

  it("calcula variação e respeita a direção desejável", () => {
    const up = calculateVariation("120", "100");
    const down = calculateVariation("80", "100");
    expect(up).toEqual({ status: "ok", value: "20" });
    expect(compareDirection(up, "up")).toBe("favorable");
    expect(compareDirection(up, "down")).toBe("unfavorable");
    expect(compareDirection(down, "down")).toBe("favorable");
    expect(compareDirection(up, "neutral")).toBe("neutral");
  });
});
