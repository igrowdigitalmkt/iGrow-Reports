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

export const MAX_SERIES_DAYS = 90;

// ready: confirmed account row. empty: confirmed collection with no delivery rows
// (not zero, not missing). missing: no confirmed snapshot. invalid: snapshot exists
// but fails validation or does not match the account currency/timezone.
export type SnapshotSeriesDayStatus = "ready" | "empty" | "missing" | "invalid";

export type SnapshotSeriesPoint = {
  date: string;
  status: SnapshotSeriesDayStatus;
  // nativeKey → decimal string, or null when the indicator is absent that day
  values: Record<string, string | null>;
  collectedAt: string | null;
};

export type SnapshotSeriesData = {
  accountName: string;
  points: SnapshotSeriesPoint[];
  // Indicator keys with one consistent unit across every confirmed day
  keys: string[];
  units: Record<string, string>;
  currency: string;
  timezone: string;
  missingDates: string[];
  invalidDates: string[];
  // The chart is released only when every day is confirmed (ready or empty).
  complete: boolean;
};

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function seriesDates(from: string, to: string): string[] {
  z.iso.date().parse(from);
  z.iso.date().parse(to);
  if (from > to) throw new Error("Período inválido para a série diária.");
  const dates: string[] = [];
  for (let current = from; current <= to; current = shiftDate(current, 1)) {
    dates.push(current);
    if (dates.length > MAX_SERIES_DAYS) throw new Error(`A série diária suporta até ${MAX_SERIES_DAYS} dias.`);
  }
  return dates;
}

async function resolveSeriesScope(client: SupabaseClient<Database>, clientId: string, accountId: string, dateFrom: string, dateTo: string) {
  z.uuid().parse(clientId);
  z.uuid().parse(accountId);
  const dates = seriesDates(dateFrom, dateTo);

  const { data, error } = await client.rpc("list_client_snapshot_accounts", { p_client_id: clientId });
  requireCollectionRpc(error);
  if (error) throw new Error("Não foi possível consultar as contas para a série.");
  const accounts = z.array(accountSchema).max(100).parse(data);
  const account = accounts.find(a => a.id === accountId);
  if (!account) throw new Error("Conta não autorizada para esta série.");

  const config = getMetaApiConfig();
  if (!config) throw new Error("A versão da API Meta não está configurada.");

  // Identities derive from the authenticated catalog, never from client input.
  const identities = dates.map(date => buildMetaCollectionIdentity({
    clientId, connectionId: account.connection_id, externalAccountId: account.external_id,
    dateFrom: date, dateTo: date, apiVersion: config.apiVersion, level: "account",
  }));
  return { account, dates, identities };
}

async function readDay(client: SupabaseClient<Database>, identity: CollectionIdentity, account: z.infer<typeof accountSchema>, nowMs: number): Promise<SnapshotSeriesPoint & { units: Record<string, string> }> {
  const date = identity.dateFrom;
  const absent = (status: SnapshotSeriesDayStatus) => ({ date, status, values: {}, collectedAt: null, units: {} });
  let snapshot;
  try {
    snapshot = await readConfirmedCollectionSnapshot(client, identity, nowMs);
  } catch (error) {
    if (error instanceof SnapshotValidationError) return absent("invalid");
    throw error;
  }
  if (snapshot.status === "empty") return absent("missing");
  if (!snapshot.entities.length) return { date, status: "empty", values: {}, collectedAt: snapshot.collectedAt, units: {} };
  const entity = snapshot.entities.find(item => item.id === account.external_id);
  if (snapshot.entities.length !== 1 || !entity || entity.currency !== account.currency || entity.timezone !== account.timezone_name) {
    return absent("invalid");
  }
  return { date, status: "ready", values: { ...entity.values }, collectedAt: snapshot.collectedAt, units: entity.units };
}

// Account-level daily series: one exact 1-day snapshot per calendar day. Values are
// never derived by distributing a period aggregate across days.
export async function loadSnapshotSeries(
  client: SupabaseClient<Database>,
  clientId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
  now = new Date(),
): Promise<SnapshotSeriesData> {
  const { account, identities } = await resolveSeriesScope(client, clientId, accountId, dateFrom, dateTo);
  const nowMs = now.getTime();
  const days: Awaited<ReturnType<typeof readDay>>[] = [];
  for (let offset = 0; offset < identities.length; offset += 8) {
    days.push(...await Promise.all(identities.slice(offset, offset + 8).map(identity => readDay(client, identity, account, nowMs))));
  }

  const units: Record<string, string> = {};
  const conflicting = new Set<string>();
  for (const day of days) {
    for (const key of Object.keys(day.values)) {
      const unit = day.units[key];
      if (!unit) { conflicting.add(key); continue; }
      if (units[key] && units[key] !== unit) conflicting.add(key);
      units[key] ??= unit;
    }
  }
  for (const key of conflicting) delete units[key];

  const missingDates = days.filter(day => day.status === "missing").map(day => day.date);
  const invalidDates = days.filter(day => day.status === "invalid").map(day => day.date);
  return {
    accountName: account.name,
    points: days.map(day => ({ date: day.date, status: day.status, values: day.values, collectedAt: day.collectedAt })),
    keys: Object.keys(units),
    units,
    currency: account.currency,
    timezone: account.timezone_name,
    missingDates,
    invalidDates,
    complete: !missingDates.length && !invalidDates.length,
  };
}

// Identities for every day of the period (account level), for a series refresh.
export async function resolveSeriesIdentities(
  client: SupabaseClient<Database>,
  clientId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
): Promise<CollectionIdentity[]> {
  return (await resolveSeriesScope(client, clientId, accountId, dateFrom, dateTo)).identities;
}

// Identities for the days still without a confirmed snapshot (account level only).
export async function resolveSeriesMissingIdentities(
  client: SupabaseClient<Database>,
  clientId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
  now = new Date(),
): Promise<CollectionIdentity[]> {
  const { account, identities } = await resolveSeriesScope(client, clientId, accountId, dateFrom, dateTo);
  const missing: CollectionIdentity[] = [];
  for (let offset = 0; offset < identities.length; offset += 8) {
    const batch = identities.slice(offset, offset + 8);
    const days = await Promise.all(batch.map(identity => readDay(client, identity, account, now.getTime())));
    days.forEach((day, index) => { if (day.status === "missing") missing.push(batch[index]); });
  }
  return missing;
}
