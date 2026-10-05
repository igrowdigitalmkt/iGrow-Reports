import Decimal from "decimal.js";
import type { SnapshotBundle } from "../integrations/snapshot-bundle-reader";
import type { CollectionEntityMetadata, CollectionIdentity, MetricValueState } from "../integrations/data-contract";
import { metaMetricLabel } from "./metric-labels";

export type MetaSnapshotIndicator = {
  key: string; nativeKey: string; label: string; value: string | null;
  state: MetricValueState; unit: string; aggregationRule: string;
};
export type MetaSnapshotEntityView = {
  id: string; name: string; hierarchy: CollectionEntityMetadata | null;
  currency: string | null; timezone: string; indicators: MetaSnapshotIndicator[];
  // Delivery status is not part of the collection contract.
  deliveryStatus: null;
  attributionWindow?: string | null;
};
export type MetaSnapshotView = {
  status: "pending" | "ready" | "stale"; collectedAt: string | null;
  missing: CollectionIdentity[];
  scopes: Array<{ identity: CollectionIdentity; snapshotId: string; collectedAt: string; entities: MetaSnapshotEntityView[] }>;
};

// Map presentation names without converting decimal values or aggregating scopes.
export function projectMetaSnapshotView(bundle: SnapshotBundle): MetaSnapshotView {
  if (bundle.status === "pending") return { status: "pending", collectedAt: null, missing: bundle.missing.map(identity => ({ ...identity })), scopes: [] };
  return {
    status: bundle.status, collectedAt: bundle.collectedAt, missing: [],
    scopes: bundle.scopes.map(({ identity, snapshot }) => {
      if (identity.provider !== "meta" || snapshot.status === "empty" || !snapshot.snapshotId || !snapshot.collectedAt) {
        throw new Error("Snapshot incompatível com a visualização Meta.");
      }
      return {
        identity: { ...identity }, snapshotId: snapshot.snapshotId, collectedAt: snapshot.collectedAt,
        entities: snapshot.entities.map(entity => {
          const keys = new Set<string>();
          const indicators = Object.entries(entity.values).map(([nativeKey, value]) => {
            const key = nativeKey === "inline_link_clicks" ? "link_clicks" : nativeKey;
            if (keys.has(key)) throw new Error("Indicadores duplicados na visualização Meta.");
            keys.add(key);
            const state = entity.states[nativeKey];
            const unit = entity.units[nativeKey];
            const aggregationRule = entity.aggregationRules[nativeKey];
            if (!state || !unit || !aggregationRule) throw new Error("Indicador sem metadados na visualização Meta.");
            const indicator = nativeKey.startsWith("result:provider:") ? nativeKey.slice("result:provider:".length) : key;
            return { key, nativeKey, label: metaMetricLabel(indicator, indicator), value, state, unit, aggregationRule };
          });
          return { id: entity.id, name: entity.metadata?.name ?? entity.id,
            hierarchy: entity.metadata ? { ...entity.metadata } : null, currency: entity.currency,
            timezone: entity.timezone, indicators, deliveryStatus: null,
            ...(entity.attributionWindow !== undefined ? { attributionWindow: entity.attributionWindow } : {}) };
        }),
      };
    }),
  };
}

// cost: spend of the campaigns optimized for this result type divided by its count;
// null when that spend cannot be attributed to a single type.
export type SnapshotResultBreakdown = { key: string; label: string; value: string; cost?: string | null };

const ResultAmount = Decimal.clone({ precision: 80 });
const known = (indicators: MetaSnapshotIndicator[]) => indicators.find(item => item.key === "result:provider_known")?.value === "1";
const providerResults = (indicators: MetaSnapshotIndicator[]) => indicators.filter(item => item.nativeKey.startsWith("result:provider:") && item.value !== null);

// Meta reports native results per campaign, not for the account aggregate. When
// every campaign identified its results, add each result type separately across
// campaigns; different types are never added together.
function campaignResults(campaigns: MetaSnapshotEntityView[]): SnapshotResultBreakdown[] | null {
  if (!campaigns.length || !campaigns.every(campaign => known(campaign.indicators))) return null;
  const totals = new Map<string, { label: string; value: Decimal; spend: Decimal }>();
  let spendAttributable = true;
  for (const campaign of campaigns) {
    const results = providerResults(campaign.indicators);
    const spend = campaign.indicators.find(item => item.key === "spend")?.value ?? null;
    // A campaign with spend but zero or several result types cannot assign its
    // spend to one type, so per-type costs would be understated or mixed.
    if (spend === null || (results.length !== 1 && !new ResultAmount(spend).isZero())) spendAttributable = false;
    for (const item of results) {
      const current = totals.get(item.nativeKey);
      totals.set(item.nativeKey, {
        label: item.label,
        value: (current?.value ?? new ResultAmount(0)).plus(item.value!),
        spend: (current?.spend ?? new ResultAmount(0)).plus(results.length === 1 && spend !== null ? spend : 0),
      });
    }
  }
  return [...totals].map(([key, { label, value, spend }]) => ({
    key, label, value: value.toFixed(),
    cost: spendAttributable && !value.isZero() ? spend.div(value).toFixed() : null,
  }));
}

// Split native result indicators from the general list. When Meta reports more
// than one result type for an entity, list each type instead of adding them.
export function splitSnapshotResultIndicators(indicators: MetaSnapshotIndicator[], accountCampaigns?: MetaSnapshotEntityView[]) {
  const own = known(indicators) ? providerResults(indicators).map(item => ({ key: item.nativeKey, label: item.label, value: item.value! })) : null;
  const derived = !own && accountCampaigns ? campaignResults(accountCampaigns) : null;
  const breakdown: SnapshotResultBreakdown[] = own ?? derived ?? [];
  const general = indicators.filter(item => item.key !== "result:provider_known" && !item.nativeKey.startsWith("result:provider:"));
  const resultKeys = new Set(["primary_results", "cost_per_result"]);
  let primary = general.find(item => item.key === "primary_results")?.value ?? null;
  let cost = general.find(item => item.key === "cost_per_result")?.value ?? null;
  if (derived) {
    const spend = general.find(item => item.key === "spend")?.value ?? null;
    primary = derived.length === 1 ? derived[0].value : derived.length === 0 ? "0" : null;
    cost = primary !== null && spend !== null && !new ResultAmount(primary).isZero() ? new ResultAmount(spend).div(primary).toFixed() : null;
  }
  return {
    breakdown,
    mixedResults: breakdown.length > 1,
    derivedFromCampaigns: derived !== null,
    primary, cost,
    indicators: [...general.filter(item => resultKeys.has(item.key)), ...general.filter(item => !resultKeys.has(item.key))],
  };
}
