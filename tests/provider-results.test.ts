import { describe, expect, it } from "vitest";
import { campaignResultTotals, campaignResultValues, providerResultTotals, providerResultValues } from "@/modules/meta/result-values";
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
    expect(aggregateResults({ ...childAds, spend: 1557.8 }, true).primary_results).toBeNull();
    expect(resultBreakdown(childAds!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 103 }), expect.objectContaining({ value: 425 }),
    ]));
  });
  it("treats a confirmed zero-delivery campaign as zero Results instead of invalidating the total", () => {
    const totals = campaignResultTotals([
      { date_start: "2026-07-05", date_stop: "2026-10-02", spend: "10", impressions: "100",
        results: [{ indicator: "actions:lead", values: [{ value: "5" }] }] },
      { date_start: "2026-07-05", date_stop: "2026-10-02", campaign_id: "20", campaign_name: "Sem veiculação" },
    ]);
    expect(totals).toMatchObject({ "result:provider_known": 1, "result:provider:action:lead": 5 });
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", campaign_id: "20", campaign_name: "Sem veiculação" }))
      .toEqual({ "result:provider_known": 1 });
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", campaign_id: "21", spend: "0", impressions: "0" }))
      .toEqual({ "result:provider_known": 1 });
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", campaign_id: "22", spend: "0", impressions: "0",
      results: [{ indicator: "actions:lead", values: [] }] }))
      .toEqual({ "result:provider_known": 1 });
  });
  it("does not publish a partial strict provider total when a delivering campaign lacks results", () => {
    expect(providerResultTotals([
      { date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:lead", values: [{ value: "5" }] }] },
      { date_start: "2026-07-05", date_stop: "2026-10-02", spend: "10", impressions: "100" },
    ])).toBeNull();
  });
  it("does not guess the result type for campaigns missing provider results", () => {
    const totals = campaignResultTotals([
      { date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:onsite_conversion.messaging_conversation_started_7d", values: [{ value: "103" }] }] },
      { date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:post_engagement", values: [{ value: "38150" }] }] },
      { date_start: "2026-07-05", date_stop: "2026-10-02", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "76" }] },
    ]);
    expect(totals).toBeNull();
  });
  it("campanha de Cadastros sem o campo nativo usa o lead do formulário como resultado; dia sem lead é zero", () => {
    const base = { date_start: "2026-11-20", date_stop: "2026-11-20", objective: "OUTCOME_LEADS", spend: "207.62", impressions: "11317" };
    expect(providerResultValues({ ...base, actions: [{ action_type: "link_click", value: "187" }, { action_type: "lead", value: "15" }, { action_type: "onsite_conversion.lead_grouped", value: "15" }] }))
      .toEqual({ "result:provider_known": 1, "result:provider:action:onsite_conversion.lead_grouped": 15 });
    expect(providerResultValues({ ...base, actions: [{ action_type: "lead", value: "9" }] }))
      .toEqual({ "result:provider_known": 1, "result:provider:action:onsite_conversion.lead_grouped": 9 });
    expect(providerResultValues({ ...base, actions: [{ action_type: "link_click", value: "40" }] }))
      .toEqual({ "result:provider_known": 1, "result:provider:action:onsite_conversion.lead_grouped": 0 });
    const totals = providerResultTotals([{ ...base, actions: [{ action_type: "lead", value: "15" }] }, { ...base, actions: [{ action_type: "lead", value: "13" }] }]);
    expect(totals).toEqual({ "result:provider_known": 1, "result:provider:action:onsite_conversion.lead_grouped": 28 });
  });
  it("o campo nativo continua mandando: com results válidos o fallback de cadastros não entra", () => {
    expect(providerResultValues({ date_start: "2026-11-20", date_stop: "2026-11-20", objective: "OUTCOME_LEADS", spend: "10", impressions: "100",
      actions: [{ action_type: "lead", value: "99" }], results: [{ indicator: "actions:onsite_conversion.messaging_conversation_started_7d", values: [{ value: "4" }] }] }))
      .toEqual({ "result:provider_known": 1, "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 4 });
  });
  it("o fallback vale só para Cadastros e só com as ações confirmadas: outros objetivos ou ação inválida continuam desconhecidos", () => {
    const row = { date_start: "2026-11-20", date_stop: "2026-11-20", spend: "10", impressions: "100", actions: [{ action_type: "lead", value: "5" }] };
    expect(providerResultValues({ ...row, objective: "OUTCOME_ENGAGEMENT" })).toBeNull();
    expect(providerResultValues({ ...row, objective: "LINK_CLICKS" })).toBeNull();
    expect(providerResultValues({ date_start: "2026-11-20", date_stop: "2026-11-20", objective: "OUTCOME_LEADS", spend: "10", impressions: "100" })).toBeNull();
    expect(providerResultValues({ ...row, objective: "OUTCOME_LEADS", actions: [{ action_type: "lead", value: "abc" }] })).toBeNull();
    expect(providerResultValues({ ...row, objective: "OUTCOME_LEADS", actions: [{ action_type: "lead", value: "-3" }] })).toBeNull();
  });
  it("does not invent a campaign result when provider and compatible actions are both absent", () => {
    expect(campaignResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", spend: "10", impressions: "100" })).toBeNull();
  });
  it("does not add alternative attribution windows or invent an unknown result", () => {
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02" })).toBeNull();
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:lead", values: [{ value: "5" }, { value: "7" }] }] })).toBeNull();
    expect(providerResultValues({ date_start: "2026-07-05", date_stop: "2026-10-02", results: [{ indicator: "actions:lead", values: [{ value: null }] }] })).toBeNull();
  });
});
