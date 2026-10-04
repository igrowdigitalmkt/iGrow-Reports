import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CollectionIdentity } from "./data-contract";
import type { SnapshotProjection } from "./snapshot-projection";
import { readConfirmedCollectionSnapshot } from "./snapshot-reader";

type ScopeSnapshot = { identity: CollectionIdentity; snapshot: SnapshotProjection };
export type SnapshotBundle =
  | { status: "pending"; missing: CollectionIdentity[]; scopes: []; collectedAt: null }
  | { status: "ready" | "stale"; missing: []; scopes: ScopeSnapshot[]; collectedAt: string };

// An all-or-nothing presentation bundle, not a cross-snapshot DB transaction.
// Each read retains its own snapshot ID/time and evaluates authenticated access.
export async function readConfirmedSnapshotBundle(client: SupabaseClient<Database>, identities: CollectionIdentity[], now = Date.now()): Promise<SnapshotBundle> {
  if (!identities.length || identities.length > 400) throw new Error("Seleção de snapshots inválida.");
  const scopes = identities.map(identity => ({ ...identity }));
  const first = scopes[0];
  const seen = new Set<string>();
  for (const identity of scopes) {
    if (identity.clientId !== first.clientId || identity.connectionId !== first.connectionId || identity.provider !== first.provider
      || identity.dateFrom !== first.dateFrom || identity.dateTo !== first.dateTo || identity.apiVersion !== first.apiVersion
      || identity.contractVersion !== first.contractVersion) throw new Error("Escopos incompatíveis na seleção de snapshots.");
    const key = JSON.stringify([identity.externalAccountId, identity.level]);
    if (seen.has(key)) throw new Error("Escopo duplicado na seleção de snapshots.");
    seen.add(key);
  }
  const loaded: ScopeSnapshot[] = [];
  // Bound concurrent authenticated reads for selections with many accounts.
  for (let offset = 0; offset < scopes.length; offset += 8) {
    loaded.push(...await Promise.all(scopes.slice(offset, offset + 8).map(async identity => ({
      identity, snapshot: await readConfirmedCollectionSnapshot(client, identity, now),
    }))));
  }
  const missing = loaded.filter(scope => scope.snapshot.status === "empty").map(scope => scope.identity);
  if (missing.length) return { status: "pending", missing, scopes: [], collectedAt: null };
  const oldest = loaded.reduce((current, scope) => Date.parse(scope.snapshot.collectedAt!) < Date.parse(current)
    ? scope.snapshot.collectedAt! : current, loaded[0].snapshot.collectedAt!);
  return { status: loaded.some(scope => scope.snapshot.status === "stale") ? "stale" : "ready", missing: [], scopes: loaded, collectedAt: oldest };
}
