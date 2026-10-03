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
  const parsed = z.object({ clientId: z.uuid(), from: z.string(), to: z.string(), automatic: z.boolean().optional(), includeComparison: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { error: "Cliente ou período inválido." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canCollect && !parsed.data.automatic) return { error: "Seu perfil não pode atualizar os dados deste cliente." };
  const { data: dataContext } = await context.supabase.rpc("get_client_portal_data_context", { p_client_id: parsed.data.clientId }).single();
  let range;
  try {
    range = resolveAnalyticsRange({ periodo: "custom", from: parsed.data.from, to: parsed.data.to }, dataContext?.timezone_name ?? "America/Sao_Paulo");
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Período inválido." };
  }
  try {
    const current = await getClientAnalytics(context.supabase, parsed.data.clientId, parsed.data.from, parsed.data.to);
    const periods = [];
    if (!parsed.data.automatic || needsAnalyticsRefresh(current)) periods.push({ since: parsed.data.from, until: parsed.data.to, forceRefresh: !parsed.data.automatic && current.coverage.status === "complete" });
    if (parsed.data.includeComparison !== false && current.coverage.previousStatus !== "complete") {
      periods.push({ since: range.previousDateFrom, until: range.previousDateTo, forceRefresh: false });
    }
    if (!periods.length) return { success: true as const, insightCount: 0 };
    let insightCount = 0;
    let failed = false;
    try {
      for (const period of periods) {
        const result = await collectMetaClientInsights({ agencyId: context.access.agencyId,
          clientId: parsed.data.clientId, actorId: context.user.id, ...period });
        insightCount += result.insightCount;
        failed ||= result.failures.length > 0;
      }
    } finally {
      revalidatePath(`/cliente/${parsed.data.clientId}`);
      revalidatePath("/dashboard/clientes");
    }
    const verified = await getClientAnalytics(context.supabase, parsed.data.clientId, parsed.data.from, parsed.data.to);
    if (verified.coverage.status !== "complete") {
      return {
        error: `A coleta ainda não fechou o período completo (${verified.coverage.coveredDays}/${verified.coverage.totalDays} dias confirmados). O dashboard continuará bloqueado e tentará novamente.`,
        insightCount,
      };
    }
    if (failed) {
      return { error: "O período atual foi concluído, mas a Meta não terminou todos os dados auxiliares ou de comparação. Os números atuais estão completos; tente novamente para concluir o restante.", insightCount };
    }
    return { success: true as const, insightCount };
  } catch (error) {
    return { error: error instanceof MetaSetupError ? error.message : error instanceof MetaApiError && error.code === 190
      ? "A credencial Meta expirou ou foi rejeitada. Atualize a conexão do cliente."
      : "A Meta não concluiu a atualização. Confira o acesso às contas e tente novamente." };
  }
}
