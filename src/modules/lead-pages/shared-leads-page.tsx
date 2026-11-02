import { notFound } from "next/navigation";
import { after } from "next/server";
import { authorizeLeadsLink } from "./hub-access";
import { queryBoard } from "./hub-query";
import { syncStaleSources } from "./hub-sync";
import { SharedLeadsView } from "./shared-leads-view";

/** Página do link compartilhado (usada por /leads/[código] e pelo endereço antigo /leads-cadastro-rmimobiliaria/[código]). */
export async function SharedLeadsPage({ code }: { code: string }) {
  const access = await authorizeLeadsLink(code, { touch: true });
  if (!access) notFound();
  const board = await queryBoard(access.service, { clientId: access.clientId, restrictFormIds: access.restrictFormIds });
  if (!board) throw new Error("Não foi possível carregar os leads.");
  after(() => syncStaleSources(access.service, access.clientId).catch(() => undefined));
  return <SharedLeadsView code={code} clientName={access.clientName} initial={board} canUpdate={access.canUpdate} />;
}
