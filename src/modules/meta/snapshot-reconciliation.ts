import Decimal from "decimal.js";
import type { SnapshotBundle } from "../integrations/snapshot-bundle-reader";
import type { SnapshotEntityProjection } from "../integrations/snapshot-projection";

const Amount = Decimal.clone({ precision: 60 });
export type SnapshotReconciliation = { confirmed: boolean; reason: "missing" | "hierarchy" | "spend" | null };

function spend(entity: SnapshotEntityProjection): Decimal | null {
  const value = entity.values.spend;
  if (value == null || !value.trim()) return null;
  try {
    const parsed = new Amount(value);
    return parsed.isFinite() && !parsed.isNegative() ? parsed : null;
  } catch { return null; }
}

function matches(parent: Decimal,children: SnapshotEntityProjection[]) {
  let total = new Amount(0);
  for (const child of children) {
    const value = spend(child);
    if (value === null) return false;
    total = total.plus(value);
  }
  const tolerance = Amount.max("0.005",parent.abs().times("0.0000000001"));
  return total.minus(parent).abs().lte(tolerance);
}

function groupChildren(entities: SnapshotEntityProjection[],parent: "campaignId" | "adsetId") {
  const groups = new Map<string,SnapshotEntityProjection[]>();
  for (const entity of entities) {
    const id = entity.metadata?.[parent];
    if (!id) continue;
    const children = groups.get(id) ?? [];
    children.push(entity); groups.set(id,children);
  }
  return groups;
}

// Reconcile each parent against only its direct children, never combine levels.
export function reconcileMetaSnapshotBundle(bundle: SnapshotBundle): SnapshotReconciliation {
  if (bundle.status === "pending") return { confirmed: false, reason: "missing" };
  const accountScopes = bundle.scopes.filter(scope => scope.identity.level === "account");
  if (!accountScopes.length || bundle.scopes.some(scope => !accountScopes.some(account =>
    account.identity.externalAccountId === scope.identity.externalAccountId))) return { confirmed: false, reason: "missing" };
  for (const account of bundle.scopes.filter(scope => scope.identity.level === "account")) {
    const scopes = bundle.scopes.filter(scope => scope.identity.externalAccountId === account.identity.externalAccountId);
    const campaigns = scopes.find(scope => scope.identity.level === "campaign");
    const adsets = scopes.find(scope => scope.identity.level === "adset");
    const ads = scopes.find(scope => scope.identity.level === "ad");
    if (!campaigns || !adsets || !ads || scopes.length !== 4) return { confirmed: false, reason: "missing" };
    if (account.snapshot.entities.length > 1) return { confirmed: false, reason: "spend" };
    const campaignIds = new Set(campaigns.snapshot.entities.map(entity => entity.id));
    const adsetMap = new Map(adsets.snapshot.entities.map(entity => [entity.id,entity]));
    const campaignChildren = groupChildren(adsets.snapshot.entities,"campaignId");
    const adsetChildren = groupChildren(ads.snapshot.entities,"adsetId");
    for (const scope of scopes) for (const entity of scope.snapshot.entities) {
      if (scope.identity.level === "adset" || scope.identity.level === "ad") {
        if (!entity.metadata?.campaignId || !campaignIds.has(entity.metadata.campaignId)) return { confirmed: false, reason: "hierarchy" };
        if (scope.identity.level === "ad" && (!entity.metadata.adsetId || !adsetMap.has(entity.metadata.adsetId)
          || adsetMap.get(entity.metadata.adsetId)?.metadata?.campaignId !== entity.metadata.campaignId)) return { confirmed: false, reason: "hierarchy" };
      }
    }
    const accountSpend = account.snapshot.entities.length ? spend(account.snapshot.entities[0]) : new Amount(0);
    if (accountSpend === null || !matches(accountSpend,campaigns.snapshot.entities)
      || !matches(accountSpend,adsets.snapshot.entities) || !matches(accountSpend,ads.snapshot.entities)) return { confirmed: false, reason: "spend" };
    for (const campaign of campaigns.snapshot.entities) {
      const value = spend(campaign);
      if (value === null || !matches(value,campaignChildren.get(campaign.id) ?? [])) return { confirmed: false, reason: "spend" };
    }
    for (const adset of adsets.snapshot.entities) {
      const value = spend(adset);
      if (value === null || !matches(value,adsetChildren.get(adset.id) ?? [])) return { confirmed: false, reason: "spend" };
    }
  }
  return { confirmed: true, reason: null };
}
