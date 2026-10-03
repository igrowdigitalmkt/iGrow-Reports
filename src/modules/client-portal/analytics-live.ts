import "server-only";
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
}) {
  const { supabase, clientId, dateFrom, dateTo, accountIds } = input;
  const initial = await getClientAnalytics(supabase, clientId, dateFrom, dateTo, accountIds);
  if (initial.coverage.status !== "complete" || !initial.selectedAccountIds.length) return initial;
  try {
    await refreshMetaDashboardScope({ agencyId: input.agencyId, clientId, data: initial });
    return await getClientAnalytics(supabase, clientId, dateFrom, dateTo, accountIds);
  } catch {
    initial.warnings.push("A Meta não confirmou os agregados deste período. Resultados e métricas sem confirmação permanecem indisponíveis. Atualize os dados para tentar novamente.");
    return initial;
  }
}
