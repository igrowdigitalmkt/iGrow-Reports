import type { Metadata } from "next";
import { after } from "next/server";
import { loadAlertsSnapshot } from "@/modules/lead-pages/alerts-admin";
import { authorizeLeadsClient } from "@/modules/lead-pages/hub-access";
import { listLinks, listSources } from "@/modules/lead-pages/hub-admin";
import { queryBoard } from "@/modules/lead-pages/hub-query";
import { syncStaleSources } from "@/modules/lead-pages/hub-sync";
import { LeadsWorkspace } from "@/modules/lead-pages/leads-workspace";

export const metadata: Metadata = { title: "Leads", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Menu Leads do cliente: /clientes/ID/leads. O cliente vem da rota e é validado contra a organização da sessão. */
export default async function ClientLeadsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const access = await authorizeLeadsClient(clientId);
  if (!access.allowed) return <p className="campaigns-notice">Seu acesso não inclui esta área. Peça a um administrador para liberar Clientes em Equipe › Permissões.</p>;
  const [board, sources, links, alerts] = await Promise.all([
    queryBoard(access.service, { clientId: access.clientId, restrictFormIds: null }),
    access.canManage ? listSources(access.service, access.clientId) : null,
    access.canManage ? listLinks(access.service, access.clientId) : null,
    access.canManage ? loadAlertsSnapshot(access.service, { agencyId: access.agencyId, clientId: access.clientId }) : null,
  ]);
  if (!board) throw new Error("Não foi possível carregar os leads.");
  after(() => syncStaleSources(access.service, access.clientId).catch(() => undefined));
  return <main className="main-content"><LeadsWorkspace key={access.clientId} clientId={access.clientId} clientName={access.clientName} initial={board} canUpdate={access.canUpdate}
    settings={access.canManage && sources && links ? { sources, links } : null} alerts={access.canManage ? alerts : null} /></main>;
}
