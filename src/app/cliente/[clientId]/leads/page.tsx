import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { after } from "next/server";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import { ClientPortalShell } from "@/modules/client-portal/portal-shell";
import { authorizeLeadsClient } from "@/modules/lead-pages/hub-access";
import { queryBoard } from "@/modules/lead-pages/hub-query";
import { syncStaleSources } from "@/modules/lead-pages/hub-sync";
import { LeadsWorkspace } from "@/modules/lead-pages/leads-workspace";

export const metadata: Metadata = { title: "Leads", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leads no portal do cliente (login do cliente): lista, status e notas. A equipe usa /clientes/ID/leads. */
export default async function PortalLeadsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const { user, accesses, agencyMode } = await requireClientDashboardAccess(clientId);
  const access = await authorizeLeadsClient(clientId);
  if (!access.allowed) return null;
  const board = await queryBoard(access.service, { clientId: access.clientId, restrictFormIds: null });
  if (!board) throw new Error("Não foi possível carregar os leads.");
  after(() => syncStaleSources(access.service, access.clientId).catch(() => undefined));
  return <ClientPortalShell title="Leads" hideHeading description="Cadastros dos formulários dos anúncios." userEmail={user.email} agencyMode={agencyMode} showClientSwitcher={!agencyMode && accesses.length > 1}>
    <div className="client-report-toolbar"><Link href={`/cliente/${clientId}`} className="client-topbar-link"><ArrowLeft size={14} />Voltar ao painel</Link></div>
    <LeadsWorkspace key={access.clientId} clientId={access.clientId} clientName={access.clientName} initial={board} canUpdate={access.canUpdate} settings={null} />
  </ClientPortalShell>;
}
