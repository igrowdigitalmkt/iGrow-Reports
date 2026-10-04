import Decimal from "decimal.js";
import type { CollectionIdentity, NormalizedMetric } from "../integrations/data-contract";
import type { ProviderAdapter } from "../integrations/worker-contract";
import { MetaApiError, type MetaClient } from "./client";
import { validateCollectionRange } from "./collection";

const MetaDecimal = Decimal.clone({ precision: 60 });

export type MetaWorkerContext = { client: Pick<MetaClient, "getPeriodInsights">; currency: string; timezone: string };
const SCALARS = ["spend", "impressions", "reach", "frequency", "clicks", "inline_link_clicks", "unique_clicks"] as const;

function decimal(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error("invalid metric value");
  const parsed = new MetaDecimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error("invalid metric value");
  return parsed.toFixed();
}

export function createMetaProviderAdapter(resolveContext: (identity: CollectionIdentity) => Promise<MetaWorkerContext>): ProviderAdapter {
  return {
    provider: "meta",
    async collect(identity) {
      if (identity.provider !== "meta" || identity.contractVersion !== 1 || !/^act_\d+$/.test(identity.externalAccountId)) throw new Error("invalid Meta job contract");
      validateCollectionRange(identity.dateFrom, identity.dateTo);
      const { client, currency, timezone } = await resolveContext(identity);
      if (!/^[A-Z]{3}$/.test(currency) || !timezone) throw new Error("invalid account metadata");
      let rows;
      try {
        rows = await client.getPeriodInsights({ adAccountId: identity.externalAccountId, since: identity.dateFrom, until: identity.dateTo, level: identity.level });
      } catch (error) {
        if (!(error instanceof MetaApiError)) throw error;
        if (error.reason === "timeout") throw new Error("timeout");
        if (error.httpStatus === 429 || [4, 17, 32, 613].includes(error.code ?? 0)) throw new Error("rate limit");
        if (error.httpStatus === 401 || error.httpStatus === 403 || error.code === 190) throw new Error("401 authorization revoked");
        if (error.transient || error.httpStatus >= 500) throw new Error("HTTP 503 unavailable");
        throw new Error("400 invalid provider request");
      }
      const metrics: NormalizedMetric[] = [];
      const sanitizedRows: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      const collectedAt = new Date().toISOString();
      for (const row of rows) {
        const entityId = identity.level === "account" ? row.account_id : row[`${identity.level}_id` as "campaign_id" | "adset_id" | "ad_id"];
        if (!entityId || !/^\d+$/.test(entityId) || row.account_id !== identity.externalAccountId.slice(4)
          || row.date_start !== identity.dateFrom || row.date_stop !== identity.dateTo || seen.has(entityId)) throw new Error("invalid provider response scope");
        seen.add(entityId);
        if (identity.level === "account" && rows.length > 1) throw new Error("invalid duplicate account aggregate");
        const safe: Record<string, unknown> = { account_id: row.account_id, entity_id: entityId, date_start: row.date_start, date_stop: row.date_stop };
        const append = (nativeKey: string, value: string | null, monetary: boolean, aggregationRule = "sum") => {
          metrics.push({ provider: "meta", nativeKey, clientId: identity.clientId, connectionId: identity.connectionId,
            externalAccountId: identity.externalAccountId, externalEntityId: identity.level === "account" ? identity.externalAccountId : entityId,
            level: identity.level, dateFrom: identity.dateFrom, dateTo: identity.dateTo, timezone, currency: monetary ? currency : null,
            attributionWindow: null, unit: monetary ? "currency" : nativeKey === "frequency" ? "ratio" : "count",
            value, state: value === null ? "unavailable" : new Decimal(value).isZero() ? "zero" : "available",
            collectedAt, providerUpdatedAt: null, aggregationRule, mappingVersion: identity.contractVersion });
        };
        for (const key of SCALARS) {
          const value = decimal(row[key]);
          safe[key] = value;
          append(key, value, key === "spend", key === "reach" || key === "unique_clicks" ? "non_additive" : key === "frequency" ? "ratio" : "sum");
        }
        for (const key of ["actions", "action_values"] as const) {
          if (row[key] == null) continue;
          if (!Array.isArray(row[key])) throw new Error("invalid action array");
          const totals = new Map<string, Decimal>();
          for (const action of row[key]) {
            if (!action || typeof action.action_type !== "string" || !/^[a-zA-Z0-9_.:]{1,160}$/.test(action.action_type)) throw new Error("invalid action type");
            const value = decimal(action.value);
            if (value === null) throw new Error("invalid action value");
            totals.set(action.action_type, (totals.get(action.action_type) ?? new MetaDecimal(0)).plus(value));
          }
          safe[key] = [...totals].map(([action_type, value]) => ({ action_type, value: value.toFixed() }));
          for (const [actionType, value] of totals) append(`${key === "actions" ? "action" : "value:action"}:${actionType}`, value.toFixed(), key === "action_values");
        }
        sanitizedRows.push(safe);
      }
      return { metrics, complete: true, reconciliation: { confirmed: true, validation: "account_period_level", rowCount: rows.length },
        rawPayloads: [{ endpoint: `${identity.externalAccountId}/insights`, payload: { data: sanitizedRows } }] };
    },
  };
}
