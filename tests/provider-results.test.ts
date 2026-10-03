import { describe, expect, it } from "vitest";
import { providerResultTotals, providerResultValues } from "@/modules/meta/result-values";
import { aggregateResults, resultBreakdown } from "@/modules/client-portal/analytics-results";
describe("Meta campaign results", () => {
  it("uses the provider result instead of secondary profile visits", () => {
    const selected = providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:onsite_conversion.messaging_conversation_started_7d", values: [{ value: "103" }] }] });
    const values = aggregateResults({ ...selected, spend: 1557.8, instagram_profile_visits: 425, "action:onsite_conversion.messaging_conversation_started_7d": 103 }, true);
    expect(values.primary_results).toBe(103);
    expect(values.cost_per_result).toBeCloseTo(15.12, 2);
    expect(resultBreakdown(values)[0].label).toBe("Conversas por mensagem iniciadas");
  });
  it("includes engagement when it is the campaign result", () => {
    const selected = providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:post_engagement", values: [{ value: "38150" }] }] });
    expect(aggregateResults({ ...selected, spend: 395.38 }, true).primary_results).toBe(38150);
    expect(resultBreakdown(selected!)[0].label).toBe("Engajamento com a publicação");
  });
  it("keeps the campaign result independent from different child-ad outcomes", () => {
    const campaign = providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:onsite_conversion.messaging_conversation_started_7d", values: [{ value: "103" }] }] });
    const childAds = providerResultTotals([
      { date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:onsite_conversion.messaging_conversation_started_7d", values: [{ value: "103" }] }] },
      { date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "instagram_profile_visits", values: [{ value: "425" }] }] },
    ]);
    expect(aggregateResults({ ...campaign, spend: 1557.8 }, true).primary_results).toBe(103);
    expect(aggregateResults({ ...childAds, spend: 1557.8 }, true).primary_results).toBe(528);
  });
  it("does not publish a partial native total when any campaign lacks results", () => {
    expect(providerResultTotals([
      { date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:lead", values: [{ value: "5" }] }] },
      { date_start: "2026-07-05", date_stop: "2026-10-02" },
    ])).toBeNull();
  });
  it("does not add alternative attribution windows or invent an unknown result", () => {
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02" })).toBeNull();
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:lead", values: [{ value: "5" }, { value: "7" }] }] })).toBeNull();
  });
});
