"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { resolveAnalyticsRange } from "@/modules/client-portal/range";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { AdminReportPreview } from "./types";

export async function getAgencyReportPreview(input: unknown): Promise<
  { success: true; preview: AdminReportPreview } | { error: string }
> {
  const context = await requireAgencyContext();
  const parsed = z.uuid().safeParse(input);
  if (!parsed.success) return { error: "Versão de relatório inválida." };
  const { data: version, error: versionError } = await context.supabase
    .from("report_versions")
    .select("report_id,currency,date_from,date_to,state,timezone_name")
    .eq("agency_id", context.agency.id)
    .eq("id", parsed.data)
    .maybeSingle();
  if (versionError || !version) return { error: "Relatório indisponível neste espaço de trabalho." };
  const { data: report } = await context.supabase.from("reports")
    .select("id").eq("agency_id", context.agency.id)
    .eq("id", version.report_id).is("archived_at", null).maybeSingle();
  if (!report) return { error: "Relatório indisponível neste espaço de trabalho." };
  const { data: metrics, error: metricsError } = await context.supabase
    .from("report_metrics")
    .select("metric_key,label,unit,numeric_value,display_precision")
    .eq("agency_id", context.agency.id)
    .eq("report_version_id", parsed.data)
    .order("metric_key");
  if (metricsError) return { error: "Não foi possível carregar os indicadores deste relatório." };
  return { success: true, preview: {
    currency: version.currency, dateFrom: version.date_from, dateTo: version.date_to,
    state: version.state, timezoneName: version.timezone_name,
    metrics: (metrics ?? []).map((row) => ({
      metricKey: row.metric_key, label: row.metric_key === "impressions" ? "Impressões" : row.label, unit: row.unit,
      numericValue: row.numeric_value, displayPrecision: row.display_precision,
    })),
  } };
}

const generateSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  period: z.enum(["7d", "30d", "90d", "180d", "365d", "custom"]),
  from: z.string().optional(),
  to: z.string().optional(),
  title: z.string().trim().min(2).max(200).default("Relatório de performance"),
  reportId: z.uuid().optional().nullable(),
});

const publishSchema = z.object({
  agencyId: z.uuid(),
  reportVersionId: z.uuid(),
});

export type ReportActionResult =
  | { success: true; reportVersionId?: string; warning?: string }
  | { error: string };

function canEditReports(role: string) {
  return role === "owner" || role === "admin";
}

export async function generateManualReport(
  input: unknown,
): Promise<ReportActionResult> {
  const context = await requireAgencyContext();
  if (!canEditReports(context.role)) {
    return { error: "Seu perfil não pode gerar relatórios." };
  }

  const parsed = generateSchema.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) {
    return { error: "Cliente, período ou espaço de trabalho inválido." };
  }

  const { data: dataContext, error: contextError } = await context.supabase
    .rpc("get_client_portal_data_context", { p_client_id: parsed.data.clientId })
    .single();

  if (contextError || !dataContext) {
    return {
      error: isMissingSchemaError(contextError)
        ? "A fundação de métricas ainda não foi habilitada no banco de produção."
        : "Não foi possível validar os dados do cliente.",
    };
  }

  if (dataContext.data_status !== "ok" || !dataContext.timezone_name) {
    return {
      error: dataContext.compatibility_issue === "multiple_currencies"
        ? "As contas deste cliente usam moedas diferentes e não podem ser consolidadas."
        : dataContext.compatibility_issue === "multiple_timezones"
          ? "As contas deste cliente usam fusos diferentes e não podem ser consolidadas."
          : "Associe uma conta Meta válida e colete dados antes de gerar o relatório.",
    };
  }

  let range;
  try {
    range = resolveAnalyticsRange({ periodo: parsed.data.period, from: parsed.data.from, to: parsed.data.to }, dataContext.timezone_name);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Período inválido." };
  }
  const { dateFrom, dateTo } = range;

  const analytics = await getClientAnalytics(context.supabase, parsed.data.clientId, dateFrom, dateTo);
  if (analytics.coverage.status !== "complete") {
    return { error: "Atualize os dados deste período no dashboard do cliente antes de gerar o resumo. A coleta ainda está incompleta." };
  }

  const { data: summary, error: summaryError } = await context.supabase
    .rpc("get_client_portal_metric_summary", {
      p_client_id: parsed.data.clientId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    })
    .single();

  if (summaryError || !summary) {
    return { error: "Não foi possível validar os dados do período selecionado." };
  }

  if (summary.data_status !== "ok") {
    return {
      error: summary.compatibility_issue === "multiple_currencies"
        ? "As contas deste cliente usam moedas diferentes e não podem ser consolidadas."
        : summary.data_status === "incompatible" && summary.compatibility_issue === "multiple_timezones"
          ? "As contas deste cliente têm horários realmente diferentes neste período e não podem ser consolidadas com precisão."
          : "Colete dados para o período selecionado antes de gerar o relatório.",
    };
  }

  const { data, error } = await context.supabase.rpc("create_manual_report_version", {
    p_agency_id: context.agency.id,
    p_client_id: parsed.data.clientId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_report_id: parsed.data.reportId ?? null,
    p_title: parsed.data.title,
  });

  if (error) {
    return {
      error: isMissingSchemaError(error)
        ? "A fundação de relatórios ainda não foi habilitada no banco de produção."
        : "Não foi possível gerar a versão. Confirme a coleta e o resultado principal do cliente.",
    };
  }

  revalidatePath("/dashboard/relatorios");
  return {
    success: true,
    reportVersionId: data,
    warning: summary.compatibility_issue === "multiple_timezones"
      ? "As contas usam fusos diferentes. A consolidação considera as mesmas datas no calendário local de cada conta."
      : undefined,
  };
}

export async function publishReportVersion(
  input: unknown,
): Promise<ReportActionResult> {
  const context = await requireAgencyContext();
  if (!canEditReports(context.role)) {
    return { error: "Seu perfil não pode publicar relatórios." };
  }

  const parsed = publishSchema.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) {
    return { error: "Versão ou espaço de trabalho inválido." };
  }

  const { error } = await context.supabase.rpc("publish_report_version", {
    p_agency_id: context.agency.id,
    p_report_version_id: parsed.data.reportVersionId,
  });

  if (error) {
    return {
      error: isMissingSchemaError(error)
        ? "A fundação de relatórios ainda não foi habilitada no banco de produção."
        : "Não foi possível publicar esta versão.",
    };
  }

  revalidatePath("/dashboard/relatorios");
  revalidatePath("/cliente");
  return { success: true };
}
