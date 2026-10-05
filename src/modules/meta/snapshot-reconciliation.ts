import Decimal from "decimal.js";
import type { SnapshotBundle } from "../integrations/snapshot-bundle-reader";

const Amount = Decimal.clone({ precision: 60 });
export type SnapshotReconciliation = { confirmed: boolean; reason: "missing" | "hierarchy" | "spend" | null };

// Account and campaign snapshots are distinct requests. Confirm that they
// describe compatible spend before presenting them as one analysis.
export function reconcileMetaSnapshotBundle(bundle: SnapshotBundle): SnapshotReconciliation {
  if (bundle.status === "pending") return { confirmed: false, reason: "missing" };
  for (const account of bundle.scopes.filter(scope => scope.identity.level === "account")) {
    const scopes = bundle.scopes.filter(scope => scope.identity.externalAccountId === account.identity.externalAccountId);
    const campaigns = scopes.find(scope => scope.identity.level === "campaign");
    if (!campaigns) return { confirmed: false, reason: "missing" };
    if (account.snapshot.entities.length > 1) return { confirmed: false, reason: "spend" };
    const campaignIds = new Set(campaigns.snapshot.entities.map(entity => entity.id));
    const adsets = scopes.find(scope => scope.identity.level === "adset");
    const adsetMap = new Map(adsets?.snapshot.entities.map(entity => [entity.id,entity]) ?? []);
    for (const scope of scopes) for (const entity of scope.snapshot.entities) {
      if (scope.identity.level === "adset" || scope.identity.level === "ad") {
        if (!entity.metadata?.campaignId || !campaignIds.has(entity.metadata.campaignId)) return { confirmed: false, reason: "hierarchy" };
        if (scope.identity.level === "ad" && (!entity.metadata.adsetId || !adsetMap.has(entity.metadata.adsetId)
          || adsetMap.get(entity.metadata.adsetId)?.metadata?.campaignId !== entity.metadata.campaignId)) return { confirmed: false, reason: "hierarchy" };
      }
    }
    const spend = account.snapshot.entities[0]?.values.spend ?? (account.snapshot.entities.length === 0 ? "0" : null);
    if (spend === null || campaigns.snapshot.entities.some(entity => entity.values.spend == null)) return { confirmed: false, reason: "spend" };
    const sum = campaigns.snapshot.entities.reduce((total,entity) => total.plus(entity.values.spend!),new Amount(0));
    const tolerance = Amount.max("0.005",new Amount(spend).abs().times("0.0000000001"));
    if (sum.minus(spend).abs().gt(tolerance)) return { confirmed: false, reason: "spend" };
  }
  if (!bundle.scopes.some(scope => scope.identity.level === "account")) return { confirmed: false, reason: "missing" };
  return { confirmed: true, reason: null };
}
