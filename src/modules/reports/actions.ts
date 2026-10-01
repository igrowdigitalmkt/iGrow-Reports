"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { getCompletePortalPeriod } from "@/modules/client-portal/metrics";
import { isMissingSchemaError } from "@/lib/supabase/schema";

const generateSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  period: z.enum(["7d", "30d"]),
  title: z.string().trim().min(2).max(200).default("Relatório de performance"),
  reportId: z.uuid().optional().nullable(),
});

const publishSchema = z.object({
  agencyId: z.uuid(),
  reportVersionId: z.uuid(),
});

export type ReportActionResult =
  | { success: true; reportVersionId?: string }
  | { error: string };

function canEditReports(role: string) {
  return role === "owner" || role === "admin" || role === "editor";
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
    return { error: "Cliente, período ou agência inválida." };
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

  const { dateFrom, dateTo } = getCompletePortalPeriod(
    parsed.data.period,
    dataContext.timezone_name,
  );

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
  return { success: true, reportVersionId: data };
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
    return { error: "Versão ou agência inválida." };
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
