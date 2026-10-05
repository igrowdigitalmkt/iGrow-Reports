"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireClientDashboardAccess } from "./context";
import { loadSnapshotDashboard,resolveSnapshotDashboardSelection } from "./snapshot-dashboard-loader";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enqueueCollectionJobs,requestMetaCollectionRefresh } from "@/modules/integrations/repository";
import { CollectionSchemaUnavailableError } from "@/modules/integrations/collection-schema-error";
import { resolveAnalyticsRange } from "./range";
import { scheduleMetaQueueDrain } from "@/modules/meta/inline-drain";

export async function requestMissingSnapshotData(input: unknown) {
  const parsed = z.object({ clientId: z.uuid(),from: z.iso.date(),to: z.iso.date(),accountIds: z.array(z.uuid()).min(1).max(100),refresh: z.boolean().optional(),target: z.enum(["current","previous"]).optional() }).safeParse(input);
  if (!parsed.success) return { error: "Cliente, contas ou período inválidos." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canCollect) return { error: "Seu perfil não pode solicitar a coleta deste cliente." };
  try {
    const query = { periodo: "custom",from: parsed.data.from,to: parsed.data.to,accounts: parsed.data.accountIds.join(",") };
    if (parsed.data.target === "previous") {
      const selection = await resolveSnapshotDashboardSelection(context.supabase,parsed.data.clientId,query);
      const range = resolveAnalyticsRange(query,selection.accounts.filter(account => selection.selectedAccountIds.includes(account.id)).map(account => account.timezone_name));
      query.from = range.previousDateFrom; query.to = range.previousDateTo;
    }
    if (parsed.data.refresh) {
      const selection = await resolveSnapshotDashboardSelection(context.supabase,parsed.data.clientId,query);
      const service = createSupabaseServiceClient();
      if (!service) return { error: "A coleta está temporariamente indisponível." };
      const result = await requestMetaCollectionRefresh(service,selection.identities);
      scheduleMetaQueueDrain(service);
      revalidatePath(`/cliente/${parsed.data.clientId}/snapshots`);
      return { success: true as const,created: result.created+result.rescheduled };
    }
    // Identities come from the authenticated catalog and exact read, never from
    // user-supplied connection, provider, account external IDs or versions.
    const data = await loadSnapshotDashboard(context.supabase,parsed.data.clientId,query);
    if (!parsed.data.refresh && !data.view.missing.length) return { error: data.blockedReason
      ? "Os dados existentes precisam de conciliação. Solicite a verificação da coleta deste período."
      : "Os dados deste período já estão confirmados." };
    const service = createSupabaseServiceClient();
    if (!service) return { error: "A coleta está temporariamente indisponível. Tente novamente mais tarde." };
    const created = await enqueueCollectionJobs(service,data.view.missing);
    scheduleMetaQueueDrain(service);
    revalidatePath(`/cliente/${parsed.data.clientId}/snapshots`);
    return { success: true as const,created };
  } catch (error) {
    if (error instanceof CollectionSchemaUnavailableError) return { error: error.message };
    return { error: "Não foi possível solicitar os dados. Confira o acesso às contas e tente novamente." };
  }
}
