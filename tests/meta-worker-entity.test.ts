import { describe,expect,it } from "vitest";
import type { MetaInsight } from "@/modules/meta/client";
import { metaWorkerEntity } from "@/modules/meta/worker-entity";
const row: MetaInsight = { account_id: "123",campaign_id: "456",adset_id: "789",ad_id: "1011",date_start: "2026-10-01",date_stop: "2026-10-03",account_name: "Conta",campaign_name: "Campanha",adset_name: "Conjunto",ad_name: "Anúncio" };

describe("Meta snapshot hierarchy",() => {
  it.each([
    { level: "account" as const,expected: { name: "Conta",parentId: null,campaignId: null,adsetId: null } },
    { level: "campaign" as const,expected: { name: "Campanha",parentId: "act_123",campaignId: "456",adsetId: null } },
    { level: "adset" as const,expected: { name: "Conjunto",parentId: "456",campaignId: "456",adsetId: "789" } },
    { level: "ad" as const,expected: { name: "Anúncio",parentId: "789",campaignId: "456",adsetId: "789" } },
  ])("preserves the declared $level hierarchy",({ level,expected }) => {
    expect(metaWorkerEntity(row,level)).toEqual(expected);
  });
  it.each([
    { ...row,campaign_id: undefined },{ ...row,adset_id: undefined },
    { ...row,campaign_id: "act_123" },{ ...row,adset_id: "456" },{ ...row,ad_id: "789" },
  ])("rejects missing parents and contradictory identities",invalid => {
    expect(() => metaWorkerEntity(invalid,"ad")).toThrow("invalid entity hierarchy");
  });
  it("sanitizes names while retaining Unicode and allowing missing names",() => {
    expect(metaWorkerEntity({ ...row,ad_name: "  Anúncio\n🌱  " },"ad").name).toBe("Anúncio 🌱");
    expect(metaWorkerEntity({ ...row,ad_name: undefined },"ad").name).toBeNull();
  });
});
