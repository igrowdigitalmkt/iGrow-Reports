import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getMetaApiConfig } from "@/lib/env";
import { buildMetaCollectionIdentity } from "@/modules/meta/queue-identity";
import { readConfirmedCollectionSnapshot } from "@/modules/integrations/snapshot-reader";
import type { CollectionIdentity } from "@/modules/integrations/data-contract";
import { SnapshotValidationError } from "@/modules/integrations/snapshot-validation-error";
import { requireCollectionRpc } from "@/modules/integrations/collection-schema-error";
import { z } from "zod";

const accountSchema = z.object({
  id: z.uuid(), connection_id: z.uuid(), external_id: z.string().regex(/^act_\d+$/),
  name: z.string().min(1), currency: z.string().regex(/^[A-Z]{3}$/), timezone_name: z.string().min(1),
});

export type SnapshotSeriesPoint = {
  date: string;
  // nativeKey → value (decimal string) | null (unavailable/missing)
  values: Record<string, string | null>;
  missing: boolean;
};

export type SnapshotSeriesData = {
  // Account-level series: one point per calendar day (dateFrom === dateTo)
  points: SnapshotSeriesPoint[];
  // Indicator keys present in this series (union of all available days)
  keys: string[];
  // unit per nativeKey (e.g. "currency", "count", "percent")
  units: Record<string, string>;
  currency: string | null;
  timezone: string;
  // Days that have no confirmed snapshot yet
  missingDates: string[];
};

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  let current = from;
  while (current <= to) {
    dates.push(current);
    current = shiftDate(current, 1);
  }
  return dates;
}

// Load account-level daily snapshots for the selected period.
// Each day is fetched independently; missing days are noted but do not block the series.
// Max concurrent reads bound to 8 to stay within RPC limits (same pattern as bundle reader).
export async function loadSnapshotSeries(
  client: SupabaseClient<Database>,
  clientId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
  now = new Date(),
): Promise<SnapshotSeriesData> {
  z.uuid().parse(clientId);
  z.uuid().parse(accountId);

  const { data, error } = await client.rpc("list_client_snapshot_accounts", { p_client_id: clientId });
  requireCollectionRpc(error);
  if (error) throw new Error("Não foi possível consultar as contas para a série.");
  const accounts = z.array(accountSchema).max(100).parse(data);
  const account = accounts.find(a => a.id === accountId);
  if (!account) throw new Error("Conta não autorizada para esta série.");

  const config = getMetaApiConfig();
  if (!config) throw new Error("A versão da API Meta não está configurada.");

  const dates = daysBetween(dateFrom, dateTo);
  // Cap at 90 days to avoid excessive RPC fan-out; caller should pre-check.
  if (dates.length > 90) throw new Error("A série diária suporta até 90 dias.");

  const nowMs = now.getTime();
  const missingDates: string[] = [];
  const allKeys = new Set<string>();

  const baseIdentity = {
    clientId,
    connectionId: account.connection_id,
    externalAccountId: account.external_id,
    apiVersion: config.apiVersion,
    level: "account" as const,
  };

  const points: SnapshotSeriesPoint[] = [];
  const allUnits: Record<string, string> = {};

  // Batch reads 8 at a time
  for (let offset = 0; offset < dates.length; offset += 8) {
    const batch = dates.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(async (date): Promise<SnapshotSeriesPoint> => {
      const identity: CollectionIdentity = buildMetaCollectionIdentity({ ...baseIdentity, dateFrom: date, dateTo: date });
      try {
        const snapshot = await readConfirmedCollectionSnapshot(client, identity, nowMs);
        if (snapshot.status === "empty") {
          missingDates.push(date);
          return { date, values: {}, missing: true };
        }
        // Account level: take the first (and only expected) entity
        const entity = snapshot.entities[0];
        if (!entity) return { date, values: {}, missing: false };
        const values: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(entity.values)) {
          values[key] = value;
          allKeys.add(key);
          if (entity.units[key] && !allUnits[key]) allUnits[key] = entity.units[key];
        }
        return { date, values, missing: false };
      } catch (err) {
        if (err instanceof SnapshotValidationError) {
          missingDates.push(date);
          return { date, values: {}, missing: true };
        }
        throw err;
      }
    }));
    points.push(...results);
  }

  return {
    points,
    keys: [...allKeys],
    units: allUnits,
    currency: account.currency,
    timezone: account.timezone_name,
    missingDates,
  };
}

// Build the collection identities for missing days (account level only, for daily series requests).
export async function resolveSeriesMissingIdentities(
  client: SupabaseClient<Database>,
  clientId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<CollectionIdentity[]> {
  z.uuid().parse(clientId);
  z.uuid().parse(accountId);

  const { data, error } = await client.rpc("list_client_snapshot_accounts", { p_client_id: clientId });
  requireCollectionRpc(error);
  if (error) throw new Error("Não foi possível consultar as contas.");
  const accounts = z.array(accountSchema).max(100).parse(data);
  const account = accounts.find(a => a.id === accountId);
  if (!account) throw new Error("Conta não autorizada.");

  const config = getMetaApiConfig();
  if (!config) throw new Error("A versão da API Meta não está configurada.");

  const dates = daysBetween(dateFrom, dateTo);
  if (dates.length > 90) throw new Error("A série diária suporta até 90 dias.");

  // For daily series, we only collect the account level per day.
  return dates.map(date =>
    buildMetaCollectionIdentity({
      clientId, connectionId: account.connection_id, externalAccountId: account.external_id,
      dateFrom: date, dateTo: date, apiVersion: config.apiVersion, level: "account",
    })
  );
}
