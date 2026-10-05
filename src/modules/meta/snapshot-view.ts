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

export type SnapshotResultBreakdown = { key: string; label: string; value: string };

// Split native result indicators from the general list. When Meta reports more
// than one result type for an entity, list each type instead of adding them.
export function splitSnapshotResultIndicators(indicators: MetaSnapshotIndicator[]) {
  const known = indicators.find(item => item.key === "result:provider_known")?.value === "1";
  const breakdown: SnapshotResultBreakdown[] = known ? indicators
    .filter(item => item.nativeKey.startsWith("result:provider:") && item.value !== null)
    .map(item => ({ key: item.nativeKey, label: item.label, value: item.value! })) : [];
  const general = indicators.filter(item => item.key !== "result:provider_known" && !item.nativeKey.startsWith("result:provider:"));
  const resultKeys = new Set(["primary_results", "cost_per_result"]);
  return {
    breakdown,
    mixedResults: breakdown.length > 1,
    indicators: [...general.filter(item => resultKeys.has(item.key)), ...general.filter(item => !resultKeys.has(item.key))],
  };
}
