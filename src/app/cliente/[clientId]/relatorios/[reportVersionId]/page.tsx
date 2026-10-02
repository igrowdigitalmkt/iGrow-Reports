import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { getSavedReportDocument } from "@/modules/client-portal/report-actions";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";
import { SavedReportViewer } from "@/modules/reports/saved-report-viewer";
import { reportDate } from "@/modules/reports/report-presentation";
export const metadata: Metadata = { title: "Visualizar relatório", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ReportPage({ params }: { params: Promise<{ clientId: string; reportVersionId: string }> }) {
  const { clientId, reportVersionId } = await params;
  const { user, accesses, agencyMode } = await requireClientDashboardAccess(clientId);
  const result = await getSavedReportDocument({ clientId, versionId: reportVersionId });
  if ("error" in result) notFound();
  const doc = result.document;
  return <ClientPortalShell title={doc.title} description={`${doc.clientName} · ${reportDate(doc.data.dateFrom)} a ${reportDate(doc.data.dateTo)}`} userEmail={user.email} agencyMode={agencyMode} showClientSwitcher={accesses.length > 1}>
    <div className="client-report-toolbar"><Link href={`/cliente/${clientId}?aba=reports`} className="client-topbar-link"><ArrowLeft size={14} />Voltar aos relatórios</Link></div>
    <SavedReportViewer document={doc} />
  </ClientPortalShell>;
}
