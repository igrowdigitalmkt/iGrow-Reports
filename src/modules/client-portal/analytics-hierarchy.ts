import { normalizeAnalyticsValues } from "./analytics-calculations";
import type { AnalyticsValues } from "./analytics-types";

export type AnalyticsEntity = {
  key: string; id: string; level: "campaign" | "adset" | "ad"; name: string;
  parentId: string | null; campaignId: string | null; accountId: string;
  accountName: string; currency: string; values: AnalyticsValues;
  effectiveStatus?: string | null;
  thumbnailUrl?: string | null;
};

export function normalizeHierarchy(input: unknown): AnalyticsEntity[] {
  if (!Array.isArray(input)) return [];
  return input.filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter(r => ["campaign", "adset", "ad"].includes(String(r.level)))
    .map(r => ({ key: String(r.key), id: String(r.id), level: r.level as AnalyticsEntity["level"],
      name: String(r.name), parentId: typeof r.parentId === "string" ? r.parentId : null,
      campaignId: typeof r.campaignId === "string" ? r.campaignId : null,
      accountId: String(r.accountId), accountName: String(r.accountName), currency: String(r.currency),
      values: normalizeAnalyticsValues(r.values),
      effectiveStatus: typeof r.effectiveStatus === "string" ? r.effectiveStatus : null,
      thumbnailUrl: typeof r.thumbnailUrl === "string" ? r.thumbnailUrl : null,
    }));
}

export function entityDeliveryActive(entity: Pick<AnalyticsEntity, "effectiveStatus">) {
  return entity.effectiveStatus?.trim().toUpperCase() === "ACTIVE";
}

export function entityDeliveryLabel(entity: Pick<AnalyticsEntity, "effectiveStatus">) {
  return entityDeliveryActive(entity) ? "Ativo" : "Desativado";
}

export function entityDeliveryRank(entity: Pick<AnalyticsEntity, "effectiveStatus">) {
  return entityDeliveryActive(entity) ? 1 : 0;
}

// Current delivery is independent of the metrics period. Historical activity
// qualifies only when the campaign spent a positive amount in that period.
export function relevantCampaignHierarchy(entities: AnalyticsEntity[]): AnalyticsEntity[] {
  const campaigns = new Set(entities.filter(entity => entity.level === "campaign"
    && (entityDeliveryActive(entity) || (Number.isFinite(entity.values.spend) && (entity.values.spend ?? 0) > 0)))
    .map(entity => `${entity.accountId}:${entity.id}`));
  return entities.filter(entity => campaigns.has(`${entity.accountId}:${entity.level === "campaign" ? entity.id : entity.campaignId}`));
}

export function entityChildren(entity: AnalyticsEntity, entities: AnalyticsEntity[]) {
  return entities.filter(child => child.accountId === entity.accountId && child.parentId === entity.id
    && child.level === (entity.level === "campaign" ? "adset" : "ad"));
}

export function leafKeys(entity: AnalyticsEntity, entities: AnalyticsEntity[]): string[] {
  const children = entity.level === "ad" ? [] : entityChildren(entity, entities);
  return children.length ? children.flatMap(child => leafKeys(child, entities)) : [entity.key];
}

// Fully selected parents replace their children so a mixed selection never
// adds campaign, ad set and ad totals for the same delivery twice.
export function compactEntitySelection(entities: AnalyticsEntity[], selectedLeaves: string[]): string[] {
  const selected = new Set(selectedLeaves);
  const visit = (entity: AnalyticsEntity): string[] => {
    const leaves = leafKeys(entity, entities);
    if (leaves.every(key => selected.has(key))) return [entity.key];
    return entityChildren(entity, entities).flatMap(visit);
  };
  return entities.filter(e => e.level === "campaign").flatMap(visit);
}
