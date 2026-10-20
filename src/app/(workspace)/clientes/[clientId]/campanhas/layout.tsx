import type { ReactNode } from "react";
import { AssistantSessionProvider } from "@/modules/campaigns/assistant/session";

/**
 * Compartilha o Assistente Groow (conversas por contexto, painel aberto/fechado) entre a lista e as telas de detalhes do MESMO cliente.
 * A chave é o cliente da rota: abrir outro cliente descarta conversas e estado, nunca os reaproveita.
 */
export default async function CampaignsLayout({ children, params }: { children: ReactNode; params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  return <AssistantSessionProvider key={clientId}>{children}</AssistantSessionProvider>;
}
