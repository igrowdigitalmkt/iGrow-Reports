import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { Database } from "@/types/database";
import type { ReportsAdminSnapshot } from "./types";

async function allRows<T>(query: (from: number, to: number) => PromiseLike<{data: T[] | null; error: {code?: string; message?: string} | null}>) {
  const rows: T[] = [];
  for(let from=0;;from+=250) {
    const result=await query(from,from+249);
    if(result.error) return {data:null,error:result.error};
    rows.push(...(result.data ?? []));
    if(!result.data || result.data.length<250) return {data:rows,error:null};
  }
}

export async function getReportsAdminSnapshot(
  supabase: SupabaseClient<Database>,
  agencyId: string,
): Promise<ReportsAdminSnapshot> {
  const [versionsResult, reportsResult, clientsResult] = await Promise.all([
    allRows((from,to) => supabase
      .from("report_versions")
      .select("id,report_id,client_id,version_number,date_from,date_to,currency,state,data_collected_at,generated_at,published_at")
      .eq("agency_id", agencyId)
      .order("generated_at", { ascending: false })
      .order("id").range(from,to)),
    allRows((from,to) => supabase
      .from("reports")
      .select("id,title").is("archived_at", null)
      .eq("agency_id", agencyId).order("id").range(from,to)),
    allRows((from,to) => supabase
      .from("clients")
      .select("id,name")
      .eq("agency_id", agencyId).order("id").range(from,to)),
  ]);

  const reportSchemaMissing =
    !!versionsResult.error &&
    !!reportsResult.error &&
    isMissingSchemaError(versionsResult.error) &&
    isMissingSchemaError(reportsResult.error);

  if (reportSchemaMissing) return { ready: false, versions: [] };

  if (versionsResult.error || reportsResult.error || clientsResult.error) {
    throw new Error("Não foi possível consultar os relatórios do espaço de trabalho.");
  }

  const reports = new Map((reportsResult.data ?? []).map((row) => [row.id, row.title]));
  const clients = new Map((clientsResult.data ?? []).map((row) => [row.id, row.name]));

  return {
    ready: true,
    versions: (versionsResult.data ?? []).filter(row => reports.has(row.report_id)).map((row) => ({
      id: row.id,
      reportId: row.report_id,
      clientId: row.client_id,
      clientName: clients.get(row.client_id) ?? "Cliente",
      title: reports.get(row.report_id) ?? "Relatório de performance",
      versionNumber: row.version_number,
      dateFrom: row.date_from,
      dateTo: row.date_to,
      currency: row.currency,
      state: row.state,
      dataCollectedAt: row.data_collected_at,
      generatedAt: row.generated_at,
      publishedAt: row.published_at,
    })),
  };
}
