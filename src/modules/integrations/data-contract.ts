export type CollectionStatus = "queued" | "collecting" | "partial" | "confirmed" | "failed" | "superseded";
export type MetricValueState = "available" | "zero" | "unavailable" | "error";
export type EntityLevel = "account" | "campaign" | "adset" | "ad";

export type CollectionIdentity = {
  clientId: string;
  connectionId: string;
  provider: ProviderId;
  externalAccountId: string;
  dateFrom: string;
  dateTo: string;
  level: EntityLevel;
  apiVersion: string;
  contractVersion: number;
};

export function collectionIdempotencyKey(identity: CollectionIdentity): string {
  return [identity.clientId, identity.connectionId, identity.provider, identity.externalAccountId, identity.dateFrom, identity.dateTo, identity.level, identity.apiVersion, identity.contractVersion].join(":");
}

export type CollectionEntityMetadata = {
  name: string | null;
  parentId: string | null;
  campaignId: string | null;
  adsetId: string | null;
};

export type NormalizedMetric = {
  entity?: CollectionEntityMetadata;
  provider: ProviderId;
  nativeKey: string;
  clientId: string;
  connectionId: string;
  externalAccountId: string;
  externalEntityId: string;
  level: EntityLevel;
  dateFrom: string;
  dateTo: string;
  timezone: string;
  currency: string | null;
  attributionWindow: string | null;
  unit: string;
  value: string | null;
  state: MetricValueState;
  collectedAt: string;
  providerUpdatedAt: string | null;
  aggregationRule: string;
  mappingVersion: number;
};
import type { ProviderId } from "./provider-id";

