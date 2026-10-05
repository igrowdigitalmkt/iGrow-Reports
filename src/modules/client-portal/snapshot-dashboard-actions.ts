"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireClientDashboardAccess } from "./context";
import { loadSnapshotDashboard } from "./snapshot-dashboard-loader";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enqueueCollectionJobs,requestMetaCollectionRefresh } from "@/modules/integrations/repository";
import { getMetaApiConfig } from "@/lib/env";
import { buildMetaCollectionIdentity } from "@/modules/meta/queue-identity";

export async function requestMissingSnapshotData(input: unknown) {
  const parsed = z.object({ clientId: z.uuid(),from: z.iso.date(),to: z.iso.date(),accountIds: z.array(z.uuid()).min(1).max(100),refresh: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { error: "Cliente, contas ou período inválidos." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canCollect) return { error: "Seu perfil não pode solicitar a coleta deste cliente." };
  try {
    // Identities come from the authenticated catalog and exact read, never from
    // user-supplied connection, provider, account external IDs or versions.
    const data = await loadSnapshotDashboard(context.supabase,parsed.data.clientId,{
      periodo: "custom",from: parsed.data.from,to: parsed.data.to,accounts: parsed.data.accountIds.join(","),
    });
    if (!parsed.data.refresh && !data.view.missing.length) return { error: data.blockedReason
      ? "Os dados existentes precisam de conciliação. Solicite a verificação da coleta deste período."
      : "Os dados deste período já estão confirmados." };
    const service = createSupabaseServiceClient();
    if (!service) return { error: "A coleta está temporariamente indisponível. Tente novamente mais tarde." };
    if (parsed.data.refresh) {
      const config = getMetaApiConfig();
      if (!config) return { error: "A coleta está temporariamente indisponível." };
      const identities = data.accounts.filter(account => data.selectedAccountIds.includes(account.id)).flatMap(account =>
        (["account","campaign","adset","ad"] as const).map(level => buildMetaCollectionIdentity({ clientId: parsed.data.clientId,
          connectionId: account.connection_id,externalAccountId: account.external_id,dateFrom: data.dateFrom,dateTo: data.dateTo,apiVersion: config.apiVersion,level })));
      const result = await requestMetaCollectionRefresh(service,identities);
      revalidatePath(`/cliente/${parsed.data.clientId}/snapshots`);
      return { success: true as const,created: result.created+result.rescheduled };
    }
    const created = await enqueueCollectionJobs(service,data.view.missing);
    revalidatePath(`/cliente/${parsed.data.clientId}/snapshots`);
    return { success: true as const,created };
  } catch {
    return { error: "Não foi possível solicitar os dados. Confira o acesso às contas e tente novamente." };
  }
}
