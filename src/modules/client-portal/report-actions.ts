"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeHierarchy } from "./analytics-hierarchy";
import { normalizeClientAnalytics } from "./analytics-calculations";
import { metaMetricLabel } from "@/modules/meta/metric-labels";
import type { DashboardPdfInput } from "@/modules/reports/pdf-download";
import { requireClientDashboardAccess } from "./context";

const generateSchema = z.object({
  clientId: z.uuid(), dateFrom: z.iso.date(), dateTo: z.iso.date(),
  accountIds: z.array(z.uuid()).min(1).max(100),
  metricKeys: z.array(z.string().min(1).max(240)).max(200),
  entityKeys: z.array(z.string().regex(/^(campaign|adset|ad):\d+$/)).max(1000).default([]),
  campaignMetricKeys: z.array(z.string().min(1).max(240)).max(200).default([]),
  comparison: z.boolean().default(false), chartType: z.enum(["line", "bar"]).default("line"),
  header: z.object({ name: z.string().trim().max(160), details: z.string().trim().max(500) }),
  title: z.string().trim().min(2).max(200),
});

export async function generateDashboardReport(input: unknown) {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: "Configuração do relatório inválida." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canManageReports) return { error: "Seu perfil não pode salvar relatórios." };
  const { data, error } = await context.supabase.rpc("create_dashboard_report", {
    p_client_id: parsed.data.clientId, p_date_from: parsed.data.dateFrom, p_date_to: parsed.data.dateTo,
    p_ad_account_ids: parsed.data.accountIds, p_entity_keys: parsed.data.entityKeys,
    p_metric_keys: parsed.data.metricKeys, p_title: parsed.data.title, p_header: { ...parsed.data.header, comparison: parsed.data.comparison, chart_type: parsed.data.chartType, campaign_metric_keys: parsed.data.campaignMetricKeys },
  });
  if (error || !data) return { error: error?.code === "22023"
    ? "Para gerar o relatório, configure o resultado principal e colete todos os dias completos do período em contas da mesma moeda."
    : "Não foi possível gerar o relatório. Confira a seleção e tente novamente." };
  revalidatePath(`/cliente/${parsed.data.clientId}`);
  revalidatePath("/dashboard/relatorios");
  return { success: true as const, reportVersionId: data };
}

export async function deleteDashboardReport(input: unknown) {
  const parsed = z.object({ clientId: z.uuid(), reportId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Relatório inválido." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  if (!context.canManageReports) return { error: "Seu perfil não pode excluir relatórios." };
  const { error } = await context.supabase.rpc("archive_dashboard_report", {
    p_client_id: parsed.data.clientId, p_report_id: parsed.data.reportId,
  });
  if (error) return { error: "Não foi possível excluir o relatório." };
  revalidatePath(`/cliente/${parsed.data.clientId}`);
  revalidatePath("/dashboard/relatorios");
  return { success: true as const };
}

export async function getSavedReportDocument(input: unknown): Promise<{ document: DashboardPdfInput } | { error: string }> {
  const parsed = z.object({ clientId: z.uuid(), versionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Relatório inválido." };
  const context = await requireClientDashboardAccess(parsed.data.clientId);
  const { data, error } = await context.supabase.rpc("get_dashboard_report_document", { p_report_version_id: parsed.data.versionId });
  if (error || !data || typeof data !== "object" || Array.isArray(data) || data.clientId !== parsed.data.clientId) {
    return { error: "Relatório indisponível." };
  }
  const configuration = data.configuration && typeof data.configuration === "object" && !Array.isArray(data.configuration) ? data.configuration : {};
  const header = configuration.header && typeof configuration.header === "object" && !Array.isArray(configuration.header) ? configuration.header : {};
  const rawMetrics = Array.isArray(data.metrics) ? data.metrics : [];
  const metrics = rawMetrics.filter((metric): metric is Record<string, import("@/types/database").Json> => !!metric && typeof metric === "object" && !Array.isArray(metric))
    .map(metric => ({ key: String(metric.key), label: metaMetricLabel(String(metric.key), String(metric.label)),
      unit: metric.unit as "currency" | "integer" | "percent" | "ratio", precision: Number(metric.precision), desirable: "neutral" as const }));
  const analytics = normalizeClientAnalytics({ dateFrom: data.dateFrom, dateTo: data.dateTo, currency: data.currency,
    summary: data.summary, metrics, daily: configuration.daily, previousDaily: configuration.previous_daily,
    accounts: configuration.accounts, selectedAccountIds: configuration.account_ids, coverage: configuration.coverage });
  const labels = Array.isArray(configuration.scope_labels) ? configuration.scope_labels.filter((v): v is string => typeof v === "string") : [];
  return { document: { title: String(data.title), clientName: String(data.clientName), workspaceName: String(header.name ?? data.workspaceName),
    headerDetails: typeof header.details === "string" ? header.details : "", data: analytics, metrics,
    entityLabels: labels.length ? labels : ["Todas as campanhas"], accountLabels: analytics.accounts.filter(a => analytics.selectedAccountIds.includes(a.id)).map(a => a.name),
    entityRows: normalizeHierarchy(configuration.entity_rows),
    campaignMetrics: normalizeClientAnalytics({metrics:configuration.metric_catalog}).metrics
      .sort((a,b) => (Array.isArray(configuration.campaign_metric_keys) ? configuration.campaign_metric_keys.indexOf(a.key) : 0)
        - (Array.isArray(configuration.campaign_metric_keys) ? configuration.campaign_metric_keys.indexOf(b.key) : 0))
      .filter(m => Array.isArray(configuration.campaign_metric_keys) && configuration.campaign_metric_keys.includes(m.key)),
    comparison: configuration.comparison === true, chartType: configuration.chart_type === "bar" ? "bar" : "line" } };
}
