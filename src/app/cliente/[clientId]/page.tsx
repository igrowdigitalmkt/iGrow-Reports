import Link from "next/link";
import type { Metadata } from "next";
import { z } from "zod";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";
import { ClientAnalyticsDashboard } from "@/modules/client-portal/analytics-dashboard";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { resolveAnalyticsRange } from "@/modules/client-portal/range";
import { listClientPortalReports } from "@/modules/reports/client";

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
  const { supabase, user, access, accesses, agencyMode, canCollect } = await requireClientDashboardAccess(clientId);
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
  const [data, history] = await Promise.all([
    getClientAnalytics(supabase, clientId, range.dateFrom, range.dateTo, accountIds),
    listClientPortalReports(supabase, clientId),
  ]);
  return <ClientPortalShell title={access.client.name}
    description="Explore os resultados, acompanhe a evolução e transforme seus dados em decisões."
    userEmail={user.email} agencyMode={agencyMode} showClientSwitcher={!agencyMode && accesses.length > 1}>
    {filterError && <p role="alert" className="client-alert">{filterError} Exibindo os últimos 30 dias completos.</p>}
    {access.client.archivedAt && <p className="client-alert">Cliente arquivado. Histórico preservado para consulta.</p>}
    <ClientAnalyticsDashboard key={JSON.stringify([data.dateFrom, data.dateTo, data.selectedAccountIds])} data={data} clientId={clientId} canCollect={canCollect} agencyMode={agencyMode} />
    <section className="client-panel mt-5">
      <div className="client-panel-heading"><div><h2>Resumos publicados</h2><p>Versões preservadas dos resultados de cada período.</p></div></div>
      {history.reports.length ? <div className="client-report-list">{history.reports.map(report =>
        <Link key={report.reportVersionId} className="client-report-row" href={`/cliente/${clientId}/relatorios/${report.reportVersionId}`}>
          <div><strong>{report.title} · v{report.versionNumber}</strong><span>{report.dateFrom} — {report.dateTo}</span></div>
        </Link>)}
      </div> : <div className="client-report-empty"><p>Os resumos publicados pela agência aparecerão aqui.</p></div>}
    </section>
  </ClientPortalShell>;
}
