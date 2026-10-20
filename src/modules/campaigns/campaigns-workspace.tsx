"use client";

import { useMemo } from "react";
import { AssistantPanel, AssistantRail } from "./assistant/assistant-panel";
import type { AssistantAvailability, AssistantScope } from "./assistant/contracts";
import { useAssistantSession } from "./assistant/session";
import type { AssistantTransport } from "./assistant/transport";
import { CampaignsView, type SelectedEntity } from "./campaigns-view";
import type { CampaignsData } from "./load";
import { campaignsPath } from "./routes";
import "./assistant/assistant.css";

/**
 * Lista operacional de Campanhas de UM cliente (o da rota) e Assistente Groow (direita, recolhível). A seleção de contexto vive aqui,
 * acima da tabela e do painel, e é sempre resolvida contra os dados atuais: o painel não conhece a tabela e a tabela não processa mensagens.
 * A página deve montar este componente com `key={clientId}` para que a troca de cliente descarte a seleção; as conversas ficam no
 * AssistantSessionProvider do layout (compartilhadas com as telas de detalhes do mesmo cliente).
 * O envio só acontece quando o servidor declara o assistente disponível.
 */
export function CampaignsWorkspace({ organizationId, clientId, clientName, data, onlyActive, availability, preferenceKey, transport }: {
  organizationId: string; clientId: string; clientName: string; data: CampaignsData; onlyActive: boolean;
  availability: AssistantAvailability; /** Chave da preferência local de colunas (organização + usuário). */ preferenceKey: string; transport?: AssistantTransport;
}) {
  const scope = useMemo<AssistantScope>(() => ({ organizationId, clientId, platform: "meta" }), [organizationId, clientId]);
  const session = useAssistantSession({ scope, data, availability, transport });
  const { context, open, ready } = session;
  const selected: SelectedEntity | null = context.entity && context.account ? { accountId: context.account.id, level: context.entity.level, id: context.entity.id } : null;

  return <div className="campaigns-workspace">
    <div className={`campaigns-shell ${open ? "is-open" : "is-closed"}${ready ? "" : " is-unresolved"}`}>
      <div className="campaigns-main">
        <CampaignsView clientId={clientId} data={data} onlyActive={onlyActive} selected={selected} preferenceKey={preferenceKey}
          onSelectEntity={row => {
            const same = !!selected && selected.accountId === row.accountId && selected.level === row.level && selected.id === row.id;
            session.setSelection(same ? null : { scope, kind: "entity", accountId: row.accountId, level: row.level, entityId: row.id });
            if (!same && !open) session.toggle(true);
          }} />
      </div>
      {open
        ? <AssistantPanel context={context} clientName={clientName} accounts={data.accounts.filter(account => data.selectedAccountIds.includes(account.id))}
          conversation={session.conversation} availability={session.availability} onCollapse={() => session.toggle(false)} onClearContext={() => session.setSelection(null)}
          onSelectAccount={accountId => session.setSelection(accountId ? { scope, kind: "account", accountId } : session.general)} onSend={session.send}
          operational={{ href: `${campaignsPath(clientId)}#analise-operacional`, onOpen: () => window.dispatchEvent(new Event("groow:open-opportunities")) }} />
        : <AssistantRail contextActive={context.level !== "client"} onOpen={() => session.toggle(true)} />}
    </div>
  </div>;
}
