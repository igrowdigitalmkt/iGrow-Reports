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
