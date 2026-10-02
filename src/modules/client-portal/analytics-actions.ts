"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { collectMetaClientInsights, MetaSetupError } from "@/modules/meta/server";
import { MetaApiError } from "@/modules/meta/client";
import { requireClientDashboardAccess } from "./context";
import { resolveAnalyticsRange } from "./range";
import { getClientAnalytics } from "./analytics";
import { needsAnalyticsRefresh } from "./analytics-freshness";

export async function collectDashboardData(input: unknown) {
  const parsed = z.object({ clientId: z.uuid(), from: z.string(), to: z.string(), automatic: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { error: "Cliente ou período inválido." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canCollect && !parsed.data.automatic) return { error: "Seu perfil não pode atualizar os dados deste cliente." };
  const { data: dataContext } = await context.supabase.rpc("get_client_portal_data_context", { p_client_id: parsed.data.clientId }).single();
  try {
    resolveAnalyticsRange({ periodo: "custom", from: parsed.data.from, to: parsed.data.to }, dataContext?.timezone_name ?? "America/Sao_Paulo");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Período inválido." };
  }
  try {
    if (parsed.data.automatic) {
      const current = await getClientAnalytics(context.supabase, parsed.data.clientId, parsed.data.from, parsed.data.to);
      if (!needsAnalyticsRefresh(current)) return { success: true as const, insightCount: 0 };
    }
    const result = await collectMetaClientInsights({ agencyId: context.access.agencyId,
      clientId: parsed.data.clientId, actorId: context.user.id, since: parsed.data.from, until: parsed.data.to, forceRefresh: !parsed.data.automatic });
    revalidatePath(`/cliente/${parsed.data.clientId}`);
    revalidatePath("/dashboard/clientes");
    if (result.failures.length) return { error: "A Meta não confirmou todas as datas. Os valores já recebidos foram preservados. Tente atualizar novamente.", insightCount: result.insightCount };
    return { success: true as const, insightCount: result.insightCount };
  } catch (error) {
    return { error: error instanceof MetaSetupError ? error.message : error instanceof MetaApiError && error.code === 190
      ? "A credencial Meta expirou ou foi rejeitada. Atualize a conexão do cliente."
      : "A Meta não concluiu a atualização. Confira o acesso às contas e tente novamente." };
  }
}
