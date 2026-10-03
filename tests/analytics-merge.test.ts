import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mergeAnalyticsValues } from "@/modules/client-portal/analytics";

describe("long range analytical merging", () => {
  it("recalculates costs and percentage rates from totals", () => {
    const merged = mergeAnalyticsValues([
      { spend: 100, impressions: 1000, link_clicks: 10, clicks: 20, outbound_clicks: 5, "action:lead": 2, "cost:action:lead": 50, ctr_link: 1, cpc_link: 10 },
      { spend: 400, impressions: 4000, link_clicks: 190, clicks: 180, outbound_clicks: 95, "action:lead": 8, "cost:action:lead": 50, ctr_link: 4.75, cpc_link: 400 / 190 },
    ], true);
    expect(merged).toMatchObject({ spend: 500, impressions: 5000, ctr_link: 4, cpc_link: 2.5, cpm: 100, ctr: 4, cpc: 2.5, outbound_clicks_ctr: 2, "cost:action:lead": 50 });
  });
  it("preserves a native confirmation marker and adds distinct chosen indicators", () => {
    const merged = mergeAnalyticsValues([
      { spend: 100, "result:provider_known": 1, "result:provider:action:lead": 10 },
      { spend: 200, "result:provider_known": 1, "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 5 },
    ], true);
    expect(merged["result:provider_known"]).toBe(1);
    expect(merged["result:provider:action:lead"]).toBe(10);
    expect(merged["result:provider:action:onsite_conversion.messaging_conversation_started_7d"]).toBe(5);
    expect(merged.primary_results).toBeNull();
    expect(merged.cost_per_result).toBeNull();
  });
  it("does not sum reach, frequency, unique people or their rates", () => {
    const merged = mergeAnalyticsValues([
      { spend: 10, impressions: 100, reach: 80, frequency: 1.25, unique_clicks: 10, unique_ctr: 12.5, cpp: 125 },
      { spend: 20, impressions: 200, reach: 120, frequency: 1.66, unique_clicks: 20, unique_ctr: 16.66, cpp: 166.66 },
    ], true);
    expect(merged).toMatchObject({ reach: null, frequency: null, unique_clicks: null, unique_ctr: null, cpp: null });
  });
  it("keeps incomplete additive metrics and native results unknown", () => {
    const merged = mergeAnalyticsValues([
      { spend: 10, "action:lead": 2, "result:provider_known": 1, "result:provider:action:lead": 2 },
      { spend: null, "action:lead": null },
    ], true);
    expect(merged.spend).toBeNull();
    expect(merged["action:lead"]).toBeNull();
    expect(merged["result:provider_known"]).toBeUndefined();
    expect(merged.primary_results).toBeNull();
    expect(merged["cost:action:lead"]).toBeNull();
  });
});
