import "server-only";
import { billingBlockOf } from "@/modules/billing/guard";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { refreshMetaDashboardScope } from "@/modules/meta/server";
import { getClientAnalytics } from "./analytics";

// Read through the authenticated RPC before accessing Meta, and read again
// after refreshing the exact account/period aggregate. Every period uses this
// path, including the full-account overview without a manual entity selection.
export async function getFreshClientAnalytics(input: {
  supabase: SupabaseClient<Database>; agencyId: string; clientId: string;
  dateFrom: string; dateTo: string; accountIds?: string[];
  // A read the caller just made for the same client, period and accounts.
  initial?: Awaited<ReturnType<typeof getClientAnalytics>>;
}) {
  const { supabase, clientId, dateFrom, dateTo, accountIds } = input;
  // The analytics RPC is the heaviest database read; never repeat it needlessly.
  const initial = input.initial ?? await getClientAnalytics(supabase, clientId, dateFrom, dateTo, accountIds);
  if (initial.coverage.status !== "complete" || !initial.selectedAccountIds.length) return initial;
  try {
    const refreshed = await refreshMetaDashboardScope({ agencyId: input.agencyId, clientId, data: initial });
    // A still-valid cached aggregate is already part of the initial read.
    if (refreshed && "cached" in refreshed && refreshed.cached && initial.metaAggregate?.confirmed) return initial;
    return await getClientAnalytics(supabase, clientId, dateFrom, dateTo, accountIds);
  } catch (error) {
    // Organização com acesso restrito: continua vendo os dados já guardados; a atualização com a Meta fica pausada (não é falha do provedor).
    if (billingBlockOf(error)) {
      initial.warnings.push("Atualizações com a Meta estão pausadas porque o acesso desta organização está restrito. Os dados já coletados continuam disponíveis para consulta.");
      return initial;
    }
    console.error("meta-dashboard-scope-refresh", {
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : "unknown",
      clientId, dateFrom, dateTo, accountCount: accountIds?.length ?? initial.selectedAccountIds.length,
    });
    initial.warnings.push("Não foi possível confirmar a análise completa deste período. Aguarde a nova tentativa automática ou tente atualizar os dados.");
    return initial;
  }
}
