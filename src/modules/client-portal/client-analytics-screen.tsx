import "server-only";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireClientDashboardAccess } from "./context";
import { ClientPortalShell } from "./portal-shell";
import { ClientAnalyticsDashboard } from "./analytics-dashboard";
import { getClientAnalytics } from "./analytics";
import { getFreshClientAnalytics } from "./analytics-live";
import { resolveAnalyticsRange } from "./range";
import { listClientPortalReports } from "@/modules/reports/client";
import { getReportsAdminSnapshot } from "@/modules/reports/admin";
import type { AnalyticsEntity } from "./analytics-hierarchy";
import type { AnalyticsReportItem } from "./analytics-types";

export type ClientAnalyticsQuery = { periodo?: string; from?: string; to?: string; accounts?: string; aba?: string; inicio?: string };

function queryString(query: ClientAnalyticsQuery) {
  const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const value = params.toString();
  return value ? `?${value}` : "";
}

// Shared by /dashboard/clientes/[clientId] (agency, inside the workspace shell)
// and /cliente/[clientId] (client users, inside the client area).
export async function ClientAnalyticsScreen({ clientId, query, frame }: { clientId: string; query: ClientAnalyticsQuery; frame: "workspace" | "portal" }) {
  const { supabase, user, access, accesses, agencyMode, canCollect, canManageReports } = await requireClientDashboardAccess(clientId);
  // Agency members work inside the workspace shell; client users keep the client area.
  if (frame === "portal" && agencyMode) redirect(`/dashboard/clientes/${clientId}${queryString(query)}`);
  if (frame === "workspace" && !agencyMode) redirect(`/cliente/${clientId}${queryString(query)}`);
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
      state: version.state, publishedAt: version.publishedAt, generatedAt: version.generatedAt, orientation: version.orientation,
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
  data = await getFreshClientAnalytics({ supabase, agencyId: access.agencyId, clientId,
    dateFrom: range.dateFrom, dateTo: range.dateTo, accountIds, initial: data });
  if (data.coverage.status !== "complete") {
    data.warnings.push("Os resultados deste período ficam bloqueados até a coleta confirmar todos os dias e contas selecionadas.");
  }
  if (data.coverage.previousStatus !== "complete") {
    data.warnings.push("A comparação anterior permanece indisponível até a cobertura desse período também ficar completa.");
  }
  const { data: headerData, error: headerError } = await supabase.rpc("get_client_report_header", { p_client_id: clientId });
  if (headerError) {
    console.error("client-report-header-rpc", {
      code: headerError.code, message: headerError.message, details: headerError.details, hint: headerError.hint, clientId,
    });
    throw new Error("Não foi possível consultar a seleção de anúncios.");
  }
  const workspaceName = headerData && typeof headerData === "object" && !Array.isArray(headerData)
    && typeof headerData.name === "string" ? headerData.name : "Espaço de trabalho";
  const entities: AnalyticsEntity[] = data.campaigns.map((campaign) => ({
    key: `campaign:${campaign.id}`, id: campaign.id, level: "campaign", name: campaign.name,
    parentId: null, campaignId: campaign.id, accountId: campaign.accountId,
    accountName: campaign.accountName, currency: campaign.currency, values: campaign.values,
    effectiveStatus: null, thumbnailUrl: null,
  }));
  const detailedAnalysisHref = agencyMode && !access.client.archivedAt
    ? `/cliente/${clientId}/snapshots?periodo=custom&from=${data.dateFrom}&to=${data.dateTo}${data.selectedAccountIds.length ? `&accounts=${data.selectedAccountIds.join(",")}` : ""}`
    : undefined;
  const content = <>
    {filterError && <p role="alert" className="client-alert">{filterError} Exibindo os últimos 30 dias completos.</p>}
    {access.client.archivedAt && <p className="client-alert">Cliente arquivado. Histórico preservado para consulta.</p>}
    <ClientAnalyticsDashboard
      key={JSON.stringify([data.dateFrom, data.dateTo, data.selectedAccountIds])}
      entities={entities} workspaceName={workspaceName} clientName={access.client.name}
      data={data} clientId={clientId} workspaceId={access.agencyId}
      canCollect={canCollect} canManageReports={canManageReports}
      reports={reportHistory} preferenceKey={`${user.id}:${clientId}`}
      detailedAnalysisHref={detailedAnalysisHref}
    />
  </>;
  if (frame === "workspace") return content;
  return <ClientPortalShell title={access.client.name} hideHeading
    description="Resultados das campanhas do período selecionado."
    userEmail={user.email} agencyMode={agencyMode} showClientSwitcher={!agencyMode && accesses.length > 1}>
    {content}
  </ClientPortalShell>;
}
