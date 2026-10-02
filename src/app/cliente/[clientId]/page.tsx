import type { Metadata } from "next";
import { z } from "zod";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";
import { ClientAnalyticsDashboard } from "@/modules/client-portal/analytics-dashboard";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { resolveAnalyticsRange } from "@/modules/client-portal/range";
import { listClientPortalReports } from "@/modules/reports/client";
import { getReportsAdminSnapshot } from "@/modules/reports/admin";
import { normalizeHierarchy } from "@/modules/client-portal/analytics-hierarchy";
import { getMetaEntityStatuses, refreshMetaDashboardScope } from "@/modules/meta/server";
import type { AnalyticsReportItem } from "@/modules/client-portal/analytics-types";

export const metadata: Metadata = {
  title: "Dashboard do cliente", robots: { index: false, follow: false }, referrer: "no-referrer",
};
export const maxDuration = 300;

export default async function ClientOverviewPage({ params, searchParams }: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ periodo?: string; from?: string; to?: string; accounts?: string }>;
}) {
  const { clientId } = await params;
  const query = await searchParams;
  const { supabase, user, access, accesses, agencyMode, canCollect, canManageReports } = await requireClientDashboardAccess(clientId);
  const { data: context } = await supabase.rpc("get_client_portal_data_context", { p_client_id: clientId }).single();
  const timezone = context?.timezone_name ?? "America/Sao_Paulo";
  let range = resolveAnalyticsRange({}, timezone);
  let filterError = "";
  let accountIds: string[] | undefined;
  try {
    range = resolveAnalyticsRange(query, timezone);
    if (query.accounts) {
      accountIds = z.array(z.uuid()).max(100).parse(query.accounts.split(","));
    }
  } catch (error) {
    filterError = error instanceof Error && !(error instanceof z.ZodError) ? error.message : "Filtro de contas inválido.";
    accountIds = undefined;
  }
  const initialData = await getClientAnalytics(supabase, clientId, range.dateFrom, range.dateTo, accountIds);
  let reportHistory: AnalyticsReportItem[] = [];
  if (agencyMode) {
    const history = await getReportsAdminSnapshot(supabase, access.agencyId);
    reportHistory = history.versions.filter((version) => version.clientId === clientId).map((version) => ({
      reportVersionId: version.id, reportId: version.reportId, title: version.title,
      versionNumber: version.versionNumber, dateFrom: version.dateFrom, dateTo: version.dateTo,
      state: version.state, publishedAt: version.publishedAt,
    }));
  } else {
    const history = await listClientPortalReports(supabase, clientId);
    reportHistory = history.reports.map((report) => ({
      reportVersionId: report.reportVersionId, reportId: report.reportId, title: report.title,
      versionNumber: report.versionNumber, dateFrom: report.dateFrom, dateTo: report.dateTo,
      state: "published" as const, publishedAt: report.publishedAt,
    }));
  }
  let data = initialData;
  if (range.period !== "custom") {
    const completeRange = resolveAnalyticsRange({ periodo: range.period }, data.accounts
      .filter(account => data.selectedAccountIds.includes(account.id)).map(account => account.timezoneName));
    if (completeRange.dateTo !== range.dateTo) {
      range = completeRange;
      data = await getClientAnalytics(supabase, clientId, range.dateFrom, range.dateTo, accountIds);
    }
  }
  try {
    await refreshMetaDashboardScope({ agencyId: access.agencyId, clientId, data });
    data = await getClientAnalytics(supabase, clientId, data.dateFrom, data.dateTo, data.selectedAccountIds);
  } catch { data.warnings.push("Alguns agregados da Meta não puderam ser atualizados. Dados já coletados foram preservados."); }
  const [hierarchy, header] = await Promise.all([
    supabase.rpc("get_client_analytics_hierarchy", { p_client_id: clientId, p_date_from: data.dateFrom,
      p_date_to: data.dateTo, p_ad_account_ids: data.selectedAccountIds }),
    supabase.rpc("get_client_report_header", { p_client_id: clientId }),
  ]);
  if (hierarchy.error || header.error) throw new Error("Não foi possível consultar a seleção de anúncios.");
  const workspaceName = header.data && typeof header.data === "object" && !Array.isArray(header.data)
    && typeof header.data.name === "string" ? header.data.name : "Espaço de trabalho";
  const entities = normalizeHierarchy(hierarchy.data);
  const statuses = await getMetaEntityStatuses({ agencyId: access.agencyId, clientId, accountIds: data.selectedAccountIds });
  for (const entity of entities) entity.effectiveStatus = statuses[`${entity.accountId}:${entity.key}`] ?? null;
  return <ClientPortalShell title={access.client.name}
    description="Explore os resultados, acompanhe a evolução e transforme seus dados em decisões."
    userEmail={user.email} agencyMode={agencyMode} showClientSwitcher={!agencyMode && accesses.length > 1}>
    {filterError && <p role="alert" className="client-alert">{filterError} Exibindo os últimos 30 dias completos.</p>}
    {access.client.archivedAt && <p className="client-alert">Cliente arquivado. Histórico preservado para consulta.</p>}
    <ClientAnalyticsDashboard
      key={JSON.stringify([data.dateFrom, data.dateTo, data.selectedAccountIds, data.coverage.latestCollectedAt])}
      entities={entities} workspaceName={workspaceName} clientName={access.client.name}
      data={data} clientId={clientId} workspaceId={access.agencyId}
      canCollect={canCollect} canManageReports={canManageReports}
      reports={reportHistory} preferenceKey={`${user.id}:${clientId}`}
    />
  </ClientPortalShell>;
}
