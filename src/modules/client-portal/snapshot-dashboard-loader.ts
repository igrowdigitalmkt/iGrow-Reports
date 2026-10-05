import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getMetaApiConfig } from "@/lib/env";
import { buildMetaCollectionIdentity } from "@/modules/meta/queue-identity";
import { readConfirmedSnapshotBundle } from "@/modules/integrations/snapshot-bundle-reader";
import type { SnapshotBundle } from "@/modules/integrations/snapshot-bundle-reader";
import { SnapshotValidationError } from "@/modules/integrations/snapshot-validation-error";
import { projectMetaSnapshotView, type MetaSnapshotView } from "@/modules/meta/snapshot-view";
import { reconcileMetaSnapshotBundle } from "@/modules/meta/snapshot-reconciliation";
import { resolveAnalyticsRange } from "./range";

const accountSchema = z.object({ id: z.uuid(),connection_id: z.uuid(),external_id: z.string().regex(/^act_\d+$/),
  name: z.string().min(1),currency: z.string().regex(/^[A-Z]{3}$/),timezone_name: z.string().min(1) });
export type SnapshotDashboardAccount = z.infer<typeof accountSchema>;
export type SnapshotDashboardData = {
  accounts: SnapshotDashboardAccount[]; selectedAccountIds: string[]; dateFrom: string; dateTo: string;
  view: MetaSnapshotView; blockedReason: "missing" | "hierarchy" | "spend" | "invalid" | "no_accounts" | null;
};

export async function loadSnapshotDashboard(client: SupabaseClient<Database>,clientId: string,
  query: { periodo?: string; from?: string; to?: string; accounts?: string }, now = new Date()): Promise<SnapshotDashboardData> {
  const selection = await resolveSnapshotDashboardSelection(client,clientId,query,now);
  const { identities,...base } = selection;
  const chosen = base.accounts.filter(account => base.selectedAccountIds.includes(account.id));
  if (!identities.length) return { ...base,view: { status: "pending",missing: [],scopes: [],collectedAt: null },blockedReason: "no_accounts" };
  let bundle: SnapshotBundle;
  try { bundle = await readConfirmedSnapshotBundle(client,identities,now.getTime()); }
  catch (error) {
    if (!(error instanceof SnapshotValidationError)) throw error;
    return { ...base,view: { status: "pending",missing: [],scopes: [],collectedAt: null },blockedReason: "invalid" };
  }
  const reconciliation = reconcileMetaSnapshotBundle(bundle);
  if (!reconciliation.confirmed) return { ...base,view: { status: "pending",missing: bundle.missing,scopes: [],collectedAt: null },blockedReason: reconciliation.reason };
  for (const scope of bundle.scopes) {
    const account = chosen.find(item => item.external_id === scope.identity.externalAccountId)!;
    if (scope.snapshot.entities.some(entity => entity.timezone !== account.timezone_name || entity.currency !== null && entity.currency !== account.currency)) {
      return { ...base,view: { status: "pending",missing: [],scopes: [],collectedAt: null },blockedReason: "invalid" };
    }
  }
  return { ...base,view: projectMetaSnapshotView(bundle),blockedReason: null };
}

// Resolve write scope independently of snapshot health: invalid historical
// metrics must not prevent an authorized operator from requesting fresh data.
export async function resolveSnapshotDashboardSelection(client: SupabaseClient<Database>,clientId: string,
  query: { periodo?: string; from?: string; to?: string; accounts?: string },now = new Date()) {
  z.uuid().parse(clientId);
  const { data,error } = await client.rpc("list_client_snapshot_accounts",{ p_client_id: clientId });
  if (error) throw new Error("Não foi possível consultar as contas autorizadas para a análise.");
  const accounts = z.array(accountSchema).max(100).parse(data);
  const selected = query.accounts ? z.array(z.uuid()).min(1).max(100).parse(query.accounts.split(",")) : accounts.map(account => account.id);
  if (new Set(selected).size !== selected.length || selected.some(id => !accounts.some(account => account.id === id))) throw new Error("Seleção de contas fora do escopo autorizado.");
  const chosen = accounts.filter(account => selected.includes(account.id));
  const range = resolveAnalyticsRange(query,chosen.map(account => account.timezone_name),now);
  const base = { accounts,selectedAccountIds: selected,dateFrom: range.dateFrom,dateTo: range.dateTo };
  if (!chosen.length) return { ...base,identities: [] };
  if (new Set(chosen.map(account => account.connection_id)).size !== 1) throw new Error("Conexões incompatíveis na análise.");
  const config = getMetaApiConfig();
  if (!config) throw new Error("A versão da API Meta não está configurada para leitura.");
  const identities = chosen.flatMap(account => (["account","campaign","adset","ad"] as const).map(level => buildMetaCollectionIdentity({
    clientId,connectionId: account.connection_id,externalAccountId: account.external_id,
    dateFrom: range.dateFrom,dateTo: range.dateTo,apiVersion: config.apiVersion,level,
  })));
  return { ...base,identities };
}
