import { describe, expect, it } from "vitest";
import { aggregateResults, resultBreakdown } from "@/modules/client-portal/analytics-results";

describe("resultados automáticos", () => {
  it("soma tipos diferentes e calcula o custo sobre o total", () => {
    const values = aggregateResults({ spend: 500, "action:onsite_conversion.messaging_conversation_started_7d": 150, instagram_profile_visits: 50, "action:lead": 50 }, true);
    expect(values.primary_results).toBe(250);
    expect(values.cost_per_result).toBe(2);
    expect(resultBreakdown(values).map(row => row.value)).toEqual([150, 50, 50]);
  });
  it("não soma aliases, curtidas, bloqueios ou respostas adicionais", () => {
    const values = aggregateResults({ "action:lead": 50, "action:onsite_conversion.lead_grouped": 50, "action:offsite_conversion.fb_pixel_lead": 50, "action:omni_purchase": 10, "action:purchase": 10, "action:like": 300, "action:onsite_conversion.messaging_block": 3 }, true);
    expect(values.primary_results).toBe(60);
  });
  it("preserva ausência de coleta e não inventa custo com moedas diferentes", () => {
    expect(aggregateResults({}, false).primary_results).toBeNull();
    expect(aggregateResults({}, true).primary_results).toBe(0);
    expect(aggregateResults({ spend: null, "action:lead": 5 }, true).cost_per_result).toBeNull();
  });
  it("usa distribuição calculada em cada entidade sem recontar aliases agregados", () => {
    expect(aggregateResults({ "result:leads": 70, "action:lead": 20, "action:onsite_conversion.lead_grouped": 50 }, true).primary_results).toBe(70);
  });
});
