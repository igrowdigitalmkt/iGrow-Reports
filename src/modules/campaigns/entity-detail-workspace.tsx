"use client";

import { useMemo, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PeriodPicker } from "@/modules/client-portal/period-picker";
import "@/modules/client-portal/analytics-dashboard.css";
import { AssistantPanel, AssistantRail } from "./assistant/assistant-panel";
import type { AssistantAvailability, AssistantScope } from "./assistant/contracts";
import { useAssistantSession } from "./assistant/session";
import type { AssistantTransport } from "./assistant/transport";
import { buildColumns, buildCostIndex, resultFamilies } from "./columns";
import { AdDetail } from "./detail/ad-detail";
import { AdSetDetail } from "./detail/adset-detail";
import { CampaignDetail } from "./detail/campaign-detail";
import type { CampaignsData } from "./load";
import { periodSearch } from "./routes";
import type { CampaignRow } from "./tree";
import "./campaigns.css";
import "./detail/detail.css";
import "./assistant/assistant.css";

/**
 * Página de uma entidade (campanha, conjunto ou anúncio) do cliente da rota. Recebe só a entidade, seus ancestrais e descendentes.
 * O Assistente Groow é o MESMO da lista (mesmos contratos, mesma sessão de conversas): o contexto inicial é a entidade aberta, e o
 * período e a conta acompanham a tela. A página deve ser montada com `key` da entidade para que a navegação entre entidades troque o contexto.
 */
export function EntityDetailWorkspace({ organizationId, clientId, clientName, entity, data, availability, transport }: {
  organizationId: string; clientId: string; clientName: string; entity: CampaignRow; data: CampaignsData; availability: AssistantAvailability; transport?: AssistantTransport;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const scope = useMemo<AssistantScope>(() => ({ organizationId, clientId, platform: "meta" }), [organizationId, clientId]);
  const initial = useMemo(() => ({ scope, kind: "entity" as const, accountId: entity.accountId, level: entity.level, entityId: entity.id }), [scope, entity.accountId, entity.level, entity.id]);
  const session = useAssistantSession({ scope, data, availability, initialSelection: initial, transport });
  const { context, open, ready } = session;
  const catalog = useMemo(() => buildColumns(data.metrics, resultFamilies(data.rows)), [data.metrics, data.rows]);
  const index = useMemo(() => buildCostIndex(data.rows), [data.rows]);
  const search = periodSearch(data);
  const props = { clientId, data, entity, catalog, index, search };

  return <div className="campaigns-workspace">
    <div className={`campaigns-shell ${open ? "is-open" : "is-closed"}${ready ? "" : " is-unresolved"}`}>
      <div className="campaigns-main">
        <div className={`campaigns-page${pending ? " is-pending" : ""}`} aria-busy={pending}>
          <div className="campaigns-toolbar"><div className="campaigns-field"><span>Período</span>
            <PeriodPicker period={data.period} dateFrom={data.dateFrom} dateTo={data.dateTo} today={data.today} disabled={pending}
              onApply={selection => {
                const next = selection.period === "custom" ? { period: "custom", dateFrom: selection.from, dateTo: selection.to } : { period: selection.period, dateFrom: "", dateTo: "" };
                startTransition(() => router.push(`${pathname}${periodSearch(next)}`));
              }} /></div></div>
          {entity.level === "campaign" ? <CampaignDetail {...props} /> : entity.level === "adset" ? <AdSetDetail {...props} /> : <AdDetail {...props} />}
        </div>
      </div>
      {open
        ? <AssistantPanel context={context} clientName={clientName} accounts={data.accounts.filter(account => data.selectedAccountIds.includes(account.id))}
          conversation={session.conversation} availability={session.availability} onCollapse={() => session.toggle(false)} onClearContext={() => session.setSelection(null)}
          onSelectAccount={accountId => session.setSelection(accountId ? { scope, kind: "account", accountId } : session.general)} onSend={session.send} />
        : <AssistantRail contextActive={context.level !== "client"} onOpen={() => session.toggle(true)} />}
    </div>
  </div>;
}
