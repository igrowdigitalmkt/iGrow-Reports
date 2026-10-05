import Decimal from "decimal.js";
import { z } from "zod";
import type { CollectionEntityMetadata,CollectionIdentity } from "./data-contract";

const metricSchema = z.object({
  provider: z.string(), nativeKey: z.string().min(1), clientId: z.string(), connectionId: z.string(),
  externalAccountId: z.string(), externalEntityId: z.string().min(1), level: z.string(),
  dateFrom: z.string(), dateTo: z.string(), timezone: z.string().min(1), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  value: z.string().nullable(), state: z.enum(["available", "zero", "unavailable", "error"]), mappingVersion: z.number().int(),
  attributionWindow: z.string().nullable().optional(),
  unit: z.string().min(1),aggregationRule: z.string().min(1),
  entity: z.object({ name: z.string().max(500).nullable(),parentId: z.string().min(1).nullable(),campaignId: z.string().min(1).nullable(),adsetId: z.string().min(1).nullable() }).optional(),
});
const snapshotSchema = z.object({ snapshotId: z.string().min(1), collectedAt: z.iso.datetime({ offset: true }), metrics: z.array(metricSchema) });
export type SnapshotEntityProjection = {
  id: string; currency: string | null; timezone: string;
  values: Record<string, string | null>;
  states: Record<string, "available" | "zero" | "unavailable" | "error">;
  units: Record<string,string>; aggregationRules: Record<string,string>;
  metadata: CollectionEntityMetadata | null;
  attributionWindow?: string | null;
};
export type SnapshotProjection = {
  status: "empty" | "ready" | "stale";
  snapshotId: string | null; collectedAt: string | null; ageMs: number | null;
  entities: SnapshotEntityProjection[];
};

// Keep decimals and per-entity scope intact. No cross-account/level aggregation.
export function projectConfirmedSnapshot(input: unknown, identity: CollectionIdentity, now = Date.now(), maxAgeMs = 3_600_000): SnapshotProjection {
  if (input === null) return { status: "empty", snapshotId: null, collectedAt: null, ageMs: null, entities: [] };
  const snapshot = snapshotSchema.parse(input);
  const collected = Date.parse(snapshot.collectedAt);
  if (!Number.isFinite(now) || maxAgeMs<=0 || !Number.isFinite(maxAgeMs) || collected>now+5_000) throw new Error("Horário do snapshot inválido.");
  const ageMs = Math.max(0,now-collected);
  const entities = new Map<string, SnapshotEntityProjection>();
  for (const metric of snapshot.metrics) {
    if (metric.clientId!==identity.clientId || metric.connectionId!==identity.connectionId || metric.provider!==identity.provider
      || metric.externalAccountId!==identity.externalAccountId || metric.level!==identity.level
      || metric.dateFrom!==identity.dateFrom || metric.dateTo!==identity.dateTo || metric.mappingVersion!==identity.contractVersion) throw new Error("Métrica fora do escopo do snapshot.");
    if (identity.provider==="meta" && identity.contractVersion>=3) {
      const metadata = metric.entity;
      if (!metadata || (metadata.parentId===metric.externalEntityId) || metadata.campaignId===metadata.adsetId && metadata.campaignId!==null) throw new Error("Hierarquia inválida no snapshot.");
      const numeric = (value: string | null) => value!==null && /^\d+$/.test(value);
      if ((identity.level==="account" && (metadata.parentId!==null || metadata.campaignId!==null || metadata.adsetId!==null || metric.externalEntityId!==identity.externalAccountId))
        || (identity.level==="campaign" && (metadata.parentId!==identity.externalAccountId || metadata.campaignId!==metric.externalEntityId || metadata.adsetId!==null || !numeric(metadata.campaignId)))
        || (identity.level==="adset" && (metadata.parentId!==metadata.campaignId || metadata.adsetId!==metric.externalEntityId || !numeric(metadata.campaignId) || !numeric(metadata.adsetId)))
        || (identity.level==="ad" && (metadata.parentId!==metadata.adsetId || !numeric(metadata.campaignId) || !numeric(metadata.adsetId) || !numeric(metric.externalEntityId) || metric.externalEntityId===metadata.campaignId))) throw new Error("Hierarquia inválida no snapshot.");
    }
    if (metric.state === "available" || metric.state === "zero") {
      if (metric.value === null || !metric.value.trim()) throw new Error("Valor confirmado inválido.");
      const value = new Decimal(metric.value);
      if (!value.isFinite() || value.isNegative() || (metric.state === "zero") !== value.isZero()) throw new Error("Estado da métrica incompatível com o valor.");
    } else if (metric.value !== null) throw new Error("Métrica indisponível com valor confirmado.");
    const entity: SnapshotEntityProjection = entities.get(metric.externalEntityId) ?? { id: metric.externalEntityId, currency: null, timezone: metric.timezone, values: {}, states: {},units: {},aggregationRules: {},metadata: metric.entity ?? null };
    if (metric.attributionWindow !== undefined) {
      if (Object.hasOwn(entity,"attributionWindow") && entity.attributionWindow !== metric.attributionWindow) throw new Error("Janelas de atribuição divergentes no snapshot.");
      entity.attributionWindow = metric.attributionWindow;
    }
    if (JSON.stringify(entity.metadata)!==JSON.stringify(metric.entity ?? null)) throw new Error("Metadados da entidade divergentes no snapshot.");
    if (entity.timezone!==metric.timezone || (entity.currency!==null && metric.currency!==null && entity.currency!==metric.currency)) throw new Error("Metadados incompatíveis no snapshot.");
    if (Object.hasOwn(entity.values,metric.nativeKey)) throw new Error("Métrica duplicada na entidade.");
    if (metric.currency!==null) entity.currency=metric.currency;
    Object.defineProperty(entity.values,metric.nativeKey,{ value: metric.value, enumerable: true, configurable: true });
    Object.defineProperty(entity.states,metric.nativeKey,{ value: metric.state, enumerable: true, configurable: true });
    Object.defineProperty(entity.units,metric.nativeKey,{ value: metric.unit, enumerable: true, configurable: true });
    Object.defineProperty(entity.aggregationRules,metric.nativeKey,{ value: metric.aggregationRule, enumerable: true, configurable: true });
    entities.set(entity.id,entity);
  }
  return { status: ageMs>=maxAgeMs ? "stale" : "ready", snapshotId: snapshot.snapshotId, collectedAt: snapshot.collectedAt, ageMs, entities: [...entities.values()] };
}
