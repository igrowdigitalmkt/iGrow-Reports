"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireClientDashboardAccess } from "./context";
import { loadSnapshotDashboard } from "./snapshot-dashboard-loader";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { enqueueCollectionJobs } from "@/modules/integrations/repository";

export async function requestMissingSnapshotData(input: unknown) {
  const parsed = z.object({ clientId: z.uuid(),from: z.iso.date(),to: z.iso.date(),accountIds: z.array(z.uuid()).min(1).max(100) }).safeParse(input);
  if (!parsed.success) return { error: "Cliente, contas ou período inválidos." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canCollect) return { error: "Seu perfil não pode solicitar a coleta deste cliente." };
  try {
    // Identities come from the authenticated catalog and exact read, never from
    // user-supplied connection, provider, account external IDs or versions.
    const data = await loadSnapshotDashboard(context.supabase,parsed.data.clientId,{
      periodo: "custom",from: parsed.data.from,to: parsed.data.to,accounts: parsed.data.accountIds.join(","),
    });
    if (!data.view.missing.length) return { error: data.blockedReason
      ? "Os dados existentes precisam de conciliação. Solicite a verificação da coleta deste período."
      : "Os dados deste período já estão confirmados." };
    const service = createSupabaseServiceClient();
    if (!service) return { error: "A coleta está temporariamente indisponível. Tente novamente mais tarde." };
    const created = await enqueueCollectionJobs(service,data.view.missing);
    revalidatePath(`/cliente/${parsed.data.clientId}/snapshots`);
    return { success: true as const,created };
  } catch {
    return { error: "Não foi possível solicitar os dados. Confira o acesso às contas e tente novamente." };
  }
}
