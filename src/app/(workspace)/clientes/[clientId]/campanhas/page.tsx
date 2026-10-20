import type { Metadata } from "next";
import { authorizeCampaignsClient } from "@/modules/campaigns/access";
import { fetchAssistantAvailability } from "@/modules/campaigns/assistant/server/actions";
import { CampaignsWorkspace } from "@/modules/campaigns/campaigns-workspace";
import { loadCampaignsData, type CampaignsQuery } from "@/modules/campaigns/load";

export const metadata: Metadata = { title: "Campanhas", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";
// A leitura ao vivo da Meta (campanhas, conjuntos e anúncios) pode levar alguns segundos em contas grandes.
export const maxDuration = 60;

/**
 * Gestão operacional de Campanhas do cliente aberto: /clientes/ID/campanhas. O cliente vem da rota e é validado contra a organização
 * da sessão; não há seletor de clientes. Somente leitura: a área não escreve em nenhuma plataforma.
 */
export default async function ClientCampaignsPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { clientId } = await params;
  const raw = await searchParams;
  const query: CampaignsQuery = {};
  for (const key of ["periodo", "from", "to", "contas", "ativas"] as const) {
    const value = raw[key];
    if (typeof value === "string") query[key] = value;
  }
  const { context, client, allowed, preferenceKey } = await authorizeCampaignsClient(clientId);
  if (!allowed) return <p className="campaigns-notice">Seu acesso não inclui esta área. Peça a um administrador para liberar Clientes em Equipe › Permissões.</p>;
  const [data, availability] = await Promise.all([loadCampaignsData(client.id, query), fetchAssistantAvailability(client.id)]);
  return <>
    <div className="page-heading"><div><h1>Campanhas</h1>
      <p>Estrutura e veiculação no Meta Ads, da campanha ao anúncio. Abra uma entidade para ver seus detalhes.</p></div></div>
    {client.archived_at && <p className="campaigns-alert">Cliente arquivado. Histórico preservado para consulta.</p>}
    <CampaignsWorkspace key={client.id} organizationId={context.agency.id} clientId={client.id} clientName={client.name} data={data}
      onlyActive={query.ativas === "1"} availability={availability} preferenceKey={preferenceKey} />
  </>;
}
