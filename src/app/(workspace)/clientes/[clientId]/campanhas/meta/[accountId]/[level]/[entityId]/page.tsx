import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { authorizeCampaignsClient } from "@/modules/campaigns/access";
import { fetchAssistantAvailability } from "@/modules/campaigns/assistant/server/actions";
import { findEntity, trimForEntity } from "@/modules/campaigns/detail";
import { EntityDetailWorkspace } from "@/modules/campaigns/entity-detail-workspace";
import { loadCampaignsData, type CampaignsQuery } from "@/modules/campaigns/load";
import { campaignsPath, parseEntityRoute } from "@/modules/campaigns/routes";
import "@/modules/campaigns/campaigns.css";

export const metadata: Metadata = { title: "Detalhes da entidade", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Notice = ({ clientId, title, text }: { clientId: string; title: string; text: string }) => <>
  <div className="campaigns-empty" role="status"><strong>{title}</strong><p>{text}</p><Link className="campaigns-link" href={campaignsPath(clientId)}>Voltar às campanhas</Link></div>
</>;

/**
 * Detalhes de uma campanha, conjunto ou anúncio: /clientes/ID/campanhas/meta/CONTA/(campanha|conjunto|anuncio)/ID-EXTERNO.
 * Toda a identidade vem da rota e é validada: cliente da organização da sessão, conta VINCULADA a esse cliente, nível e identificador.
 * Endereço inválido ou manipulado responde 404; entidade que não existe mais nesse período e conta mostra um aviso, sem cair em outra.
 */
export default async function EntityDetailPage({ params, searchParams }: {
  params: Promise<{ clientId: string; accountId: string; level: string; entityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const route = await params;
  const raw = await searchParams;
  const ref = parseEntityRoute({ platform: "meta", accountId: route.accountId, level: route.level, entityId: route.entityId });
  if (!ref) notFound();
  const query: CampaignsQuery = {};
  for (const key of ["periodo", "from", "to"] as const) {
    const value = raw[key];
    if (typeof value === "string") query[key] = value;
  }
  const { context, client, allowed } = await authorizeCampaignsClient(route.clientId);
  if (!allowed) return <p className="campaigns-notice">Seu acesso não inclui esta área. Peça a um administrador para liberar Clientes em Equipe › Permissões.</p>;
  // Só a conta da rota é lida (e precisa estar vinculada ao cliente): a lista completa do cliente não é carregada.
  const data = await loadCampaignsData(client.id, { ...query, contas: ref.accountId });
  if (data.state === "no-accounts") return <Notice clientId={client.id} title="Nenhuma conta vinculada" text="Este cliente não tem conta de anúncios da Meta vinculada." />;
  if (data.state === "error") return <Notice clientId={client.id} title="Detalhes indisponíveis" text={data.message ?? "Não foi possível consultar esta entidade agora. Tente novamente em instantes."} />;
  // A conta da rota precisa estar entre as contas vinculadas a ESTE cliente; qualquer outra (inclusive de outro cliente) é "não encontrado".
  if (!data.accounts.some(account => account.id === ref.accountId)) notFound();
  if (data.state === "blocked") return <Notice clientId={client.id} title="Detalhes ainda indisponíveis" text={data.message ?? "Os dados deste período ainda não estão confirmados."} />;
  // A conta da rota precisa ser exatamente a carregada; conta de outro cliente nunca é substituída por outra.
  if (data.selectedAccountIds.length !== 1 || data.selectedAccountIds[0] !== ref.accountId) notFound();
  const entity = findEntity(data.rows, ref);
  if (!entity) return <Notice clientId={client.id} title="Entidade não encontrada"
    text={data.metricsState === "pending" ? "Esta entidade não aparece no catálogo atual da Meta para esta conta. Ela pode ter sido removida." : "Esta entidade não existe mais nesta conta ou não tem dados no período selecionado. Ela pode ter sido removida ou arquivada."} />;
  const availability = await fetchAssistantAvailability(client.id);
  return <EntityDetailWorkspace key={`${ref.accountId}:${ref.level}:${ref.entityId}`} organizationId={context.agency.id} clientId={client.id} clientName={client.name}
    entity={entity} data={trimForEntity(data, entity)} availability={availability} />;
}
