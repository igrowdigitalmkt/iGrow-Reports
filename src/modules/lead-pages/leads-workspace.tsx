"use client";

import { useMemo, useState } from "react";
import { sessionApi } from "./leads-api";
import { LeadsBoard } from "./leads-board";
import { deleteLeadAction, deleteLeadsAction } from "./hub-actions";
import { LeadsAlerts } from "./leads-alerts";
import { LeadsPerformance } from "./leads-performance";
import { LeadsSettings } from "./leads-settings";
import type { AlertsSnapshot } from "./alerts-admin";
import type { SettingsSnapshot } from "./hub-actions";
import type { LeadsBoardData } from "./hub-types";
import "./lead-feed.css";

/** Menu Leads do cliente: aba Leads (painel) e, para quem administra, aba Configurações (Páginas conectadas e links). */
export function LeadsWorkspace({ clientId, clientName, initial, canUpdate, settings, alerts = null }: { clientId: string; clientName: string; initial: LeadsBoardData; canUpdate: boolean; settings: SettingsSnapshot | null; alerts?: AlertsSnapshot | null }) {
  const [tab, setTab] = useState<"leads" | "performance" | "alerts" | "settings">("leads");
  const api = useMemo(() => sessionApi(clientId), [clientId]);
  return <div className="leads-workspace">
    <div className="page-heading"><div><h1>Leads</h1><p>{clientName} · contatos que chegam dos seus anúncios</p></div></div>
    <div className="lead-tabs" role="tablist" aria-label="Seções de Leads">
      <button type="button" role="tab" aria-selected={tab === "leads"} className={tab === "leads" ? "is-active" : undefined} onClick={() => setTab("leads")}>Leads</button>
      <button type="button" role="tab" aria-selected={tab === "performance"} className={tab === "performance" ? "is-active" : undefined} onClick={() => setTab("performance")}>Desempenho</button>
      {alerts && <button type="button" role="tab" aria-selected={tab === "alerts"} className={tab === "alerts" ? "is-active" : undefined} onClick={() => setTab("alerts")}>Alertas</button>}
      {settings && <button type="button" role="tab" aria-selected={tab === "settings"} className={tab === "settings" ? "is-active" : undefined} onClick={() => setTab("settings")}>Configurações</button>}
    </div>
    {/* O painel continua montado ao abrir Configurações: filtros e atualização ao vivo não se perdem. */}
    <div hidden={tab !== "leads"}><LeadsBoard initial={initial} api={api} canUpdate={canUpdate} onDeleteLead={settings ? async leadId => { const result = await deleteLeadAction({ clientId, leadId }); return result.ok ? null : result.message; } : undefined}
      onDeleteLeads={settings ? async leadIds => { const result = await deleteLeadsAction({ clientId, leadIds }); return result.ok ? null : result.message; } : undefined} /></div>
    {tab === "performance" && <LeadsPerformance clientId={clientId} />}
    {alerts && tab === "alerts" && <LeadsAlerts clientId={clientId} initial={alerts} campaigns={initial.campaigns} forms={initial.forms} />}
    {settings && tab === "settings" && <LeadsSettings clientId={clientId} initial={settings} forms={initial.forms} />}
  </div>;
}
