import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { Database } from "@/types/database";
import type { ClientPortalReport, ClientPortalReportMetric } from "./types";

export async function listClientPortalReports(
  supabase: SupabaseClient<Database>,
  clientId: string,
): Promise<{ ready: boolean; reports: ClientPortalReport[] }> {
  const { data, error } = await supabase.rpc("list_client_portal_reports", {
    p_client_id: clientId,
  });
  if (error) {
    if (isMissingSchemaError(error)) return { ready: false, reports: [] };
    throw new Error("Não foi possível consultar o histórico de relatórios.");
  }
  return {
    ready: true,
    reports: (data ?? []).map((row) => ({
      reportVersionId: row.report_version_id,
      reportId: row.report_id,
      title: row.title,
      versionNumber: row.version_number,
      dateFrom: row.date_from,
      dateTo: row.date_to,
      currency: row.currency,
      timezoneName: row.timezone_name,
      dataCollectedAt: row.data_collected_at,
      publishedAt: row.published_at,
    })),
  };
}

export async function getClientPortalReportMetrics(
  supabase: SupabaseClient<Database>,
  reportVersionId: string,
): Promise<ClientPortalReportMetric[]> {
  const { data, error } = await supabase.rpc("get_client_portal_report_metrics", {
    p_report_version_id: reportVersionId,
  });
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw new Error("Não foi possível consultar esta versão do relatório.");
  }
  return (data ?? []).map((row) => ({
    metricKey: row.metric_key,
    label: row.label,
    unit: row.unit,
    numericValue: row.numeric_value,
    displayPrecision: row.display_precision,
  }));
}
