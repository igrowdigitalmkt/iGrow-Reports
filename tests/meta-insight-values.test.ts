import { describe, expect, it } from "vitest";
import type { MetaInsight } from "@/modules/meta/client";
import { applyProviderResults, confirmedEmptyPeriodValues, hasOverlappingMetaSelection, insightActionTypes, META_MESSAGE_ACTION, periodInsightValues, selectedPeriodInsightRows, sumPeriodInsightValues } from "@/modules/meta/insight-values";

const base: MetaInsight = { date_start: "2026-09-03", date_stop: "2026-10-02", account_id: "1",
  spend: "1557.80", impressions: "10000", reach: "8000", clicks: "300", inline_link_clicks: "200",
  unique_clicks: "160", unique_inline_link_clicks: "120", actions: [{ action_type: META_MESSAGE_ACTION, value: "103" }],
  results: [{ indicator: "actions:" + META_MESSAGE_ACTION, values: [{ value: "103" }] }] };

describe("canonical Meta period metrics", () => {
  it("keeps native messaging Results and computes cost using the same exact row", () => {
    const values = periodInsightValues({ ...base, instagram_profile_visits: "425" });
    expect(values).toMatchObject({ spend: 1557.8, primary_results: 103, ["action:" + META_MESSAGE_ACTION]: 103,
      instagram_profile_visits: 425, "result:provider_known": 1 });
    expect(values.cost_per_result).toBeCloseTo(15.12427, 5);
    expect(values["cost:action:" + META_MESSAGE_ACTION]).toBeCloseTo(15.12427, 5);
  });
  it("separates engagement Results from secondary conversations as verified in Ads Manager", () => {
    const values = periodInsightValues({ ...base, spend: "393.87", instagram_profile_visits: "51",
      actions: [{ action_type: META_MESSAGE_ACTION, value: "11" }, { action_type: "post_engagement", value: "37927" }],
      results: [{ indicator: "actions:post_engagement", values: [{ value: "37927" }] }] });
    expect(values.primary_results).toBe(37927);
    expect(values["action:" + META_MESSAGE_ACTION]).toBe(11);
    expect(values["cost:action:" + META_MESSAGE_ACTION]).toBeCloseTo(35.80636, 5);
    expect(values.cost_per_result).toBeCloseTo(.010385, 5);
  });
  it("leaves native Results unknown when missing even with secondary actions", () => {
    const values = periodInsightValues({ ...base, results: undefined, instagram_profile_visits: "425" });
    expect(values.primary_results).toBeNull();
    expect(values.cost_per_result).toBeNull();
    expect(values["result:provider_known"]).toBe(0);
    expect(values["action:" + META_MESSAGE_ACTION]).toBe(103);
  });
  it("distinguishes a confirmed empty response from a missing or unconfirmed response", () => {
    const unknown = periodInsightValues(undefined);
    expect(unknown.spend).toBeNull();
    expect(unknown.impressions).toBeNull();
    expect(unknown["action:" + META_MESSAGE_ACTION]).toBeNull();
    expect(unknown.primary_results).toBeNull();
    const empty = confirmedEmptyPeriodValues(["lead"]);
    expect(empty).toMatchObject({ spend: 0, impressions: 0, reach: 0, "action:lead": 0, primary_results: 0 });
    expect(empty.cpm).toBeNull();
    expect(empty.cost_per_result).toBeNull();
  });
  it("uses a present action array to confirm absent action zero, but not an omitted array", () => {
    expect(periodInsightValues({ ...base, actions: [] })["action:" + META_MESSAGE_ACTION]).toBe(0);
    expect(periodInsightValues({ ...base, actions: undefined })["action:" + META_MESSAGE_ACTION]).toBeNull();
    expect(periodInsightValues({ ...base, actions: [], cost_per_action_type: [{ action_type: META_MESSAGE_ACTION, value: "1.23" }] })["cost:action:" + META_MESSAGE_ACTION]).toBeNull();
  });
  it("preserves available native action costs instead of changing their precision", () => {
    const values = periodInsightValues({ ...base, cost_per_action_type: [{ action_type: META_MESSAGE_ACTION, value: "15.124271" }] });
    expect(values["cost:action:" + META_MESSAGE_ACTION]).toBe(15.124271);
    expect(() => periodInsightValues({ ...base, cost_per_action_type: [
      { action_type: META_MESSAGE_ACTION, value: "15" }, { action_type: META_MESSAGE_ACTION, value: "15" },
    ] })).toThrow("duplicado");
  });
  it("selects only the requested action type from array metrics", () => {
    const values = periodInsightValues({ ...base,
      outbound_clicks: [{ action_type: "outbound_click", value: "20" }, { action_type: "link_click", value: "900" }],
      video_play_actions: [{ action_type: "video_view", value: "70" }, { action_type: "post_engagement", value: "500" }] });
    expect(values.outbound_clicks).toBe(20);
    expect(values.video_plays).toBe(70);
  });
  it("computes percentage CTR on impressions and unique CTR on reached people", () => {
    const values = periodInsightValues(base);
    expect(values.ctr_link).toBe(2);
    expect(values.ctr).toBe(3);
    expect(values.unique_ctr).toBe(2);
    expect(values.unique_inline_link_click_ctr).toBe(1.5);
    expect(periodInsightValues({ ...base, unique_ctr: "2.37" }).unique_ctr).toBe(2.37);
  });
  it("does not sum purchase aliases or fabricate missing exposure from an actions-only row", () => {
    const values = periodInsightValues({ date_start: base.date_start, date_stop: base.date_stop,
      actions: [{ action_type: "purchase", value: "2" }], action_values: [
        { action_type: "omni_purchase", value: "100" }, { action_type: "purchase", value: "100" }] });
    expect(values.attributed_revenue).toBe(100);
    expect(values.spend).toBeNull();
    expect(values.impressions).toBeNull();
    expect(values.roas).toBeNull();
  });
  it("recalculates totals and costs across accounts without adding rates or costs", () => {
    const first = periodInsightValues({ ...base, spend: "100", impressions: "1000", reach: "500",
      actions: [{ action_type: META_MESSAGE_ACTION, value: "10" }],
      results: [{ indicator: "actions:" + META_MESSAGE_ACTION, values: [{ value: "10" }] }] });
    const second = periodInsightValues({ ...base, spend: "300", impressions: "3000", reach: "1500",
      actions: [{ action_type: META_MESSAGE_ACTION, value: "30" }],
      results: [{ indicator: "actions:" + META_MESSAGE_ACTION, values: [{ value: "30" }] }] });
    const total = sumPeriodInsightValues([first, second]);
    expect(total).toMatchObject({ spend: 400, primary_results: 40, cost_per_result: 10, cpm: 100,
      frequency: 2, "result:provider_known": 1 });
    expect(total["cost:action:" + META_MESSAGE_ACTION]).toBe(10);
    expect(total.ctr_link).toBe(10);
    expect(sumPeriodInsightValues([first, { ...second, spend: null }]).spend).toBeNull();
    expect(sumPeriodInsightValues([first, { ...second, "result:provider_known": 0 }]).primary_results).toBeNull();
  });
  it("blocks monetary consolidation for different currencies", () => {
    const total = sumPeriodInsightValues([periodInsightValues(base), periodInsightValues(base)], false);
    expect(total.spend).toBeNull();
    expect(total.cpm).toBeNull();
    expect(total["cost:action:" + META_MESSAGE_ACTION]).toBeNull();
    expect(total.primary_results).toBe(206);
  });
  it("removes old result families before replacing or invalidating a provider aggregate", () => {
    const values = applyProviderResults({ spend: 20, "result:messages": 50, "result:provider:action:lead": 5, primary_results: 55 }, null);
    expect(values.primary_results).toBeNull();
    expect(values["result:messages"]).toBeNull();
    expect(values["result:provider:action:lead"]).toBeUndefined();
  });
  it("does not blend different optimization outcomes into a count or cost", () => {
    const messages = periodInsightValues(base);
    const engagement = periodInsightValues({ ...base, results: [{ indicator: "actions:post_engagement", values: [{ value: "37927" }] }] });
    const total = sumPeriodInsightValues([messages, engagement]);
    expect(total.primary_results).toBeNull();
    expect(total.cost_per_result).toBeNull();
    expect(total["result:provider:action:" + META_MESSAGE_ACTION]).toBe(103);
    expect(total["result:provider:action:post_engagement"]).toBe(37927);
  });
  it("validates invalid source values and builds one action universe without alias addition", () => {
    expect(() => periodInsightValues({ ...base, spend: "NaN" })).toThrow();
    expect(() => periodInsightValues({ ...base, actions: [{ action_type: "lead", value: "" }] })).toThrow();
    expect(insightActionTypes([{ ...base, action_values: [{ action_type: "purchase", value: "10" }] }])).toEqual([META_MESSAGE_ACTION, "purchase"].sort());
  });
  it("uses Results from the actual selected entity level", () => {
    const campaign = { ...base, campaign_id: "1" };
    const ad = { ...base, campaign_id: "1", adset_id: "2", ad_id: "3",
      results: [{ indicator: "instagram_profile_visits", values: [{ value: "425" }] }] };
    const levels = [{ level: "campaign" as const, rows: [campaign] }, { level: "ad" as const, rows: [ad] }];
    expect(selectedPeriodInsightRows(levels, ["ad:3"])).toEqual([ad]);
    expect(selectedPeriodInsightRows(levels, ["campaign:1"])).toEqual([campaign]);
    expect(periodInsightValues(selectedPeriodInsightRows(levels, ["ad:3"])[0]).primary_results).toBe(425);
  });
  it("rejects parent/descendant selections that would count native Results twice", () => {
    const ads = [{ id: "3", campaign_id: "1", adset_id: "2" }, { id: "6", campaign_id: "4", adset_id: "5" }];
    expect(hasOverlappingMetaSelection(ads, ["campaign:1", "ad:3"])).toBe(true);
    expect(hasOverlappingMetaSelection(ads, ["campaign:1", "adset:2"])).toBe(true);
    expect(hasOverlappingMetaSelection(ads, ["adset:2", "ad:3"])).toBe(true);
    expect(hasOverlappingMetaSelection(ads, ["campaign:1", "ad:6"])).toBe(false);
  });
});
