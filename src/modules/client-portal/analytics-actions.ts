"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { collectMetaClientInsights, MetaSetupError } from "@/modules/meta/server";
import { MetaApiError } from "@/modules/meta/client";
import { requireClientDashboardAccess } from "./context";
import { resolveAnalyticsRange } from "./range";

export async function collectDashboardData(input: unknown) {
  const parsed = z.object({ clientId: z.uuid(), from: z.string(), to: z.string() }).safeParse(input);
  if (!parsed.success) return { error: "Cliente ou período inválido." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canCollect) return { error: "Seu perfil não pode atualizar os dados deste cliente." };
  const { data: dataContext } = await context.supabase.rpc("get_client_portal_data_context", { p_client_id: parsed.data.clientId }).single();
  try {
    resolveAnalyticsRange({ periodo: "custom", from: parsed.data.from, to: parsed.data.to }, dataContext?.timezone_name ?? "America/Sao_Paulo");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Período inválido." };
  }
  try {
    const result = await collectMetaClientInsights({ agencyId: context.access.agencyId,
      clientId: parsed.data.clientId, actorId: context.user.id, since: parsed.data.from, until: parsed.data.to, forceRefresh: true });
    revalidatePath(`/cliente/${parsed.data.clientId}`);
    revalidatePath("/dashboard/clientes");
    if (result.failures.length) return { error: `A coleta foi parcial: ${result.completedSliceCount} lotes concluídos e ${result.failures.length} pendências. Os dados concluídos foram preservados; atualize novamente para continuar.`, insightCount: result.insightCount };
    return { success: true as const, insightCount: result.insightCount };
  } catch (error) {
    return { error: error instanceof MetaSetupError ? error.message : error instanceof MetaApiError && error.code === 190
      ? "A credencial Meta expirou ou foi rejeitada. Atualize a conexão do cliente."
      : "A Meta não concluiu a coleta. Confira o acesso às contas e tente novamente." };
  }
}
