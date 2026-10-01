import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { normalizeClientAnalytics } from "./analytics-calculations";
import type { AnalyticsDashboardData } from "./analytics-types";

export async function getClientAnalytics(
  supabase: SupabaseClient<Database>,
  clientId: string,
  dateFrom: string,
  dateTo: string,
  accountIds?: string[] | null,
): Promise<AnalyticsDashboardData> {
  const { data, error } = await supabase.rpc("get_client_analytics", {
    p_client_id: clientId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_ad_account_ids: accountIds?.length ? accountIds : undefined,
  });

  if (error || !data) {
    throw new Error("Não foi possível consultar o desempenho deste cliente. Confira o período e tente novamente.");
  }
  return normalizeClientAnalytics(data);
}
