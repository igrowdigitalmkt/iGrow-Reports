import { describe, expect, it } from "vitest";
import { deliveryRate, emptySnapshot } from "@/modules/operations/dashboard-data";
import { getDemoSnapshot } from "@/modules/operations/demo-data";

describe("indicadores de comunicação", () => {
  it("distingue ausência de dados de zero entregas", () => {
    expect(deliveryRate(0, 0)).toBe("Sem dados");
    expect(deliveryRate(null, null)).toBe("Sem dados");
    expect(deliveryRate(100, 0)).toBe("0,0%");
  });
  it("usa envios aceitos como denominador e rejeita coorte inconsistente", () => {
    expect(deliveryRate(100, 98)).toBe("98,0%");
    expect(deliveryRate(2, 3)).toBe("Sem dados");
    expect(deliveryRate(2, -1)).toBe("Sem dados");
  });
  it("não inventa dados operacionais sem integrações", () => {
    const snapshot = emptySnapshot(2);
    expect(snapshot.activeClients).toBe(2);
    expect(snapshot.accepted).toBeNull();
    expect(snapshot.reportsGenerated).toBeNull();
    expect(snapshot.reports).toEqual([]);
  });
  it.each(["7d", "30d"] as const)("mantém totais e séries da demonstração coerentes para %s", period => {
    const demo = getDemoSnapshot(period);
    expect(demo.generatedSeries.reduce((a, b) => a + b, 0)).toBe(demo.reportsGenerated);
    expect(demo.deliveredSeries.reduce((a, b) => a + b, 0)).toBe(demo.delivered);
    expect(demo.delivered).toBeLessThanOrEqual(demo.accepted!);
    expect(demo.labels.length).toBe(demo.generatedSeries.length);
  });
});
