import { expect,it } from "vitest";
import type { SnapshotBundle } from "@/modules/integrations/snapshot-bundle-reader";
import { reconcileMetaSnapshotBundle } from "@/modules/meta/snapshot-reconciliation";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";
const identity: CollectionIdentity = { clientId: "c",connectionId: "i",provider: "meta",externalAccountId: "act_1",dateFrom: "2026-10-01",dateTo: "2026-10-03",level: "account",apiVersion: "v24.0",contractVersion: 3 };
function bundle(): Extract<SnapshotBundle,{ status: "ready" | "stale" }> {
  const levels = ["account","campaign","adset","ad"] as const;
  return { status: "ready",missing: [],collectedAt: "2026-10-04T12:00:00Z",scopes: levels.map(level => ({ identity: { ...identity,level },snapshot: {
    status: "ready",snapshotId: level,collectedAt: "2026-10-04T12:00:00Z",ageMs: 0,entities: [{
      id: level === "account" ? "act_1" : level === "campaign" ? "123" : level === "adset" ? "456" : "789",
      currency: "BRL",timezone: "America/Sao_Paulo",values: { spend: "123456789012345678.12345678" },states: { spend: "available" },units: { spend: "currency" },aggregationRules: { spend: "sum" },
      metadata: { name: level,parentId: level === "account" ? null : level === "campaign" ? "act_1" : level === "adset" ? "123" : "456",campaignId: level === "account" ? null : "123",adsetId: level === "ad" || level === "adset" ? "456" : null },
    }],
  } })) };
}
it("reconciles exact decimals without counting descendants again",() => {
  expect(reconcileMetaSnapshotBundle(bundle())).toEqual({ confirmed: true,reason: null });
});
it("rejects an ad linked to an absent adset",() => {
  const input = bundle(); input.scopes[3].snapshot.entities[0].metadata!.adsetId = "999";
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "hierarchy" });
});
it("rejects an ad whose campaign disagrees with its adset",() => {
  const input = bundle(); const campaign = input.scopes[1].snapshot.entities[0];
  input.scopes[1].snapshot.entities.push({ ...campaign,id: "999",values: { spend: "0" } });
  input.scopes[3].snapshot.entities[0].metadata!.campaignId = "999";
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "hierarchy" });
});
it("does not reconcile unknown campaign spend",() => {
  const input = bundle(); input.scopes[1].snapshot.entities[0].values.spend = null;
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "spend" });
});
it("does not accept entity-only data as a full-account analysis",() => {
  const input = bundle(); input.scopes.shift();
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "missing" });
});
it.each([2,3])("rejects spend divergence at child level %s",index => {
  const input = bundle(); input.scopes[index].snapshot.entities[0].values.spend = "1";
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "spend" });
});
it.each([2,3])("rejects unknown spend at child level %s",index => {
  const input = bundle(); input.scopes[index].snapshot.entities[0].values.spend = null;
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "spend" });
});
it.each([2,3])("rejects an empty child collection when its parent has spend at level %s",index => {
  const input = bundle(); input.scopes[index].snapshot.entities = [];
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: index === 2 ? "hierarchy" : "spend" });
});
it("accepts confirmed zero-spend parents with empty descendants",() => {
  const input = bundle(); input.scopes[0].snapshot.entities[0].values.spend = "0";
  input.scopes[1].snapshot.entities[0].values.spend = "0";
  input.scopes[2].snapshot.entities = []; input.scopes[3].snapshot.entities = [];
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: true,reason: null });
});
it("requires all levels even when the account/campaign totals match",() => {
  const input = bundle(); input.scopes.pop();
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "missing" });
});
it.each(["NaN","-1",""])("rejects malformed child spend %s",value => {
  const input = bundle(); input.scopes[3].snapshot.entities[0].values.spend = value;
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "spend" });
});
it("reconciles by parent, so equal global totals cannot hide displaced spend",() => {
  const input = bundle(); for (const scope of input.scopes) scope.snapshot.entities[0].values.spend = "100";
  input.scopes[0].snapshot.entities[0].values.spend = "200";
  const campaign = input.scopes[1].snapshot.entities[0];
  input.scopes[1].snapshot.entities.push({ ...campaign,id: "124",metadata: { ...campaign.metadata!,campaignId: "124" } });
  const adset = input.scopes[2].snapshot.entities[0]; adset.values.spend = "90";
  input.scopes[2].snapshot.entities.push({ ...adset,id: "457",metadata: { ...adset.metadata!,parentId: "124",campaignId: "124",adsetId: "457" },values: { spend: "110" } });
  const ad = input.scopes[3].snapshot.entities[0]; ad.values.spend = "90";
  input.scopes[3].snapshot.entities.push({ ...ad,id: "790",metadata: { ...ad.metadata!,parentId: "457",campaignId: "124",adsetId: "457" },values: { spend: "110" } });
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "spend" });
});
it("keeps same entity IDs in different accounts isolated during reconciliation",() => {
  const input = bundle(); const other = bundle();
  for (const scope of other.scopes) {
    scope.identity = { ...scope.identity,externalAccountId: "act_2" };
    scope.snapshot.entities[0].values.spend = "200";
    if (scope.identity.level === "account") scope.snapshot.entities[0].id = "act_2";
    if (scope.identity.level === "campaign") scope.snapshot.entities[0].metadata!.parentId = "act_2";
  }
  input.scopes.push(...other.scopes);
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: true,reason: null });
  other.scopes[3].snapshot.entities[0].values.spend = "100";
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "spend" });
});
it("reconciles a large disjoint hierarchy using exact decimal subtotals",() => {
  const input = bundle(); input.scopes[0].snapshot.entities[0].values.spend = "100";
  input.scopes[1].snapshot.entities[0].values.spend = "100";
  const adset = input.scopes[2].snapshot.entities[0]; const ad = input.scopes[3].snapshot.entities[0];
  input.scopes[2].snapshot.entities = Array.from({ length: 100 },(_,index) => ({ ...adset,id: String(2000+index),
    metadata: { ...adset.metadata!,adsetId: String(2000+index) },values: { spend: "1" } }));
  input.scopes[3].snapshot.entities = input.scopes[2].snapshot.entities.flatMap((parent,index) => Array.from({ length: 25 },(_,child) => ({
    ...ad,id: String(10000+index*25+child),metadata: { ...ad.metadata!,parentId: parent.id,adsetId: parent.id },values: { spend: "0.04" },
  })));
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: true,reason: null });
  input.scopes[3].snapshot.entities[2499].values.spend = "0.10";
  expect(reconcileMetaSnapshotBundle(input)).toEqual({ confirmed: false,reason: "spend" });
});
