import { describe, expect, it } from "vitest";
import { analyticsNumber, normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";

describe("normalização do dashboard do cliente", () => {
  it("preserva ausência de métricas em vez de fabricar zeros", () => {
    const data = normalizeClientAnalytics({
      summary: { spend: "300.00", reach: null, link_clicks: "100", cpc_link: "3", missing: undefined },
      previousSummary: { spend: null },
      daily: [{ date: "2026-09-29", values: { spend: "100.25" } }],
    });
    expect(data.summary).toEqual({ spend: 300, reach: null, link_clicks: 100, cpc_link: 3, missing: null });
    expect(data.previousSummary.spend).toBeNull();
    expect(data.daily).toEqual([{ date: "2026-09-29", values: { spend: 100.25 } }]);
    expect(data.coverage.status).toBe("empty");
  });

  it("rejeita entradas booleanas, infinitas, vazias e inválidas", () => {
    for (const input of [false, true, null, undefined, "", "  ", "0x10", "Infinity", Infinity, NaN, {}, []]) {
      expect(analyticsNumber(input)).toBeNull();
    }
    expect(analyticsNumber("0")).toBe(0);
    expect(analyticsNumber("1.25e2")).toBe(125);
  });

  it("mantém escopo, moeda e ações dinâmicas retornados pela RPC", () => {
    const data = normalizeClientAnalytics({
      accounts: [{ id: "a1", name: "Meta 1", currency: "BRL", externalId: "act_1", timezoneName: "America/Sao_Paulo" }],
      selectedAccountIds: ["a1"],
      summary: { "action:landing_page_view": "130" },
      metrics: [{ key: "action:landing_page_view", label: "Página de destino", unit: "integer", precision: 0, desirable: "up" }],
      coverage: { status: "partial", previousStatus: "empty", coveredDays: "4", totalDays: "30" },
      warnings: ["Dados parciais"],
    });
    expect(data.accounts[0].currency).toBe("BRL");
    expect(data.summary["action:landing_page_view"]).toBe(130);
    expect(data.coverage).toMatchObject({ status: "partial", previousStatus: "empty", coveredDays: 4, totalDays: 30 });
    expect(data.metrics[0].desirable).toBe("up");
    expect(data.warnings).toEqual(["Dados parciais"]);
  });
});
