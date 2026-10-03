import { describe, expect, it } from "vitest";
import { liveDeliveryStatuses } from "@/modules/meta/delivery";
import type { MetaAd, MetaAdSet, MetaCampaign } from "@/modules/meta/client";
import { entityDeliveryActive, entityDeliveryLabel } from "@/modules/client-portal/analytics-hierarchy";

const now = Date.parse("2026-10-03T15:00:00Z");
const campaign = { id: "1", name: "Campaign", effective_status: "ACTIVE" };
const set = { id: "2", name: "Set", campaign_id: "1", effective_status: "ACTIVE", start_time: "2026-09-01T00:00:00-0300" };
const ad = { id: "3", name: "Ad", campaign_id: "1", adset_id: "2", effective_status: "ACTIVE" };
const status = (campaigns: MetaCampaign[] = [campaign], sets: MetaAdSet[] = [set], ads: MetaAd[] = [ad]) => liveDeliveryStatuses(campaigns, sets, ads, now);

describe("live Meta delivery", () => {
  it("requires current ACTIVE campaign, scheduled set and active ad", () => {
    expect(status()).toEqual({ "campaign:1": "ACTIVE", "adset:2": "ACTIVE", "ad:3": "ACTIVE" });
  });
  it.each(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED", "UNKNOWN", "", undefined])("never marks %s green", effective_status => {
    const result = status([{ ...campaign, effective_status: effective_status as string }]);
    const entity = { effectiveStatus: result["campaign:1"] };
    expect(entityDeliveryActive(entity)).toBe(false);
    expect(entityDeliveryLabel(entity)).toBe("Desativado");
    expect(result["ad:3"]).not.toBe("ACTIVE");
  });
  it("rejects completed boosts despite ACTIVE at every level", () => {
    const result = status([campaign], [{ ...set, end_time: "2026-10-03T12:00:00-0300" }]);
    expect(Object.values(result)).not.toContain("ACTIVE");
  });
  it("rejects future, invalid or unconfirmed schedules", () => {
    for (const start_time of ["2026-10-04T00:00:00Z", "invalid", ""]) {
      expect(status([campaign], [{ ...set, start_time }])["campaign:1"]).toBe("INACTIVE");
    }
    expect(status([campaign], [{ ...set, end_time: "invalid" }])["campaign:1"]).toBe("INACTIVE");
  });
  it("fails closed when a level is missing or unavailable", () => {
    expect(status([campaign], [], [ad])["campaign:1"]).toBe("INACTIVE");
    expect(status([campaign], [set], [])["campaign:1"]).toBe("INACTIVE");
    expect(status([], [set], [ad])["ad:3"]).toBe("INACTIVE");
  });
  it("does not mix campaigns with an unrelated ad's parent", () => {
    expect(status([campaign], [set], [{ ...ad, campaign_id: "99" }])["campaign:1"]).toBe("INACTIVE");
  });
  it("keeps a campaign active with one current set and another completed set", () => {
    expect(status([campaign], [set, { ...set, id: "4", end_time: "2026-10-01T00:00:00Z" }])["campaign:1"]).toBe("ACTIVE");
  });
});
