"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Circle, Compass } from "lucide-react";
import type { ClientItem } from "@/modules/clients/schema";
import type { MetaAdminSnapshot } from "@/modules/meta/types";
import type { ReportsAdminSnapshot } from "@/modules/reports/types";
import { onboardingSteps } from "./onboarding";

export function OnboardingChecklist({ workspaceId, clients, meta, reports, analyzedClientIds }: { workspaceId: string; clients: ClientItem[]; meta?: MetaAdminSnapshot; reports?: ReportsAdminSnapshot; analyzedClientIds: string[] }) {
  const active = clients.filter(client => !client.archived_at);
  const [clientId, setClientId] = useState(active[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState(false);
  const key = `igrow:onboarding:${workspaceId}`;
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null");
        if (saved?.collapsed === true) setCollapsed(true);
        if (typeof saved?.clientId === "string" && active.some(client => client.id === saved.clientId)) setClientId(saved.clientId);
      } catch { /* Preferências opcionais não bloqueiam o início. */ }
    }, 0);
    return () => clearTimeout(timer);
  // A lista atual é validada ao montar; as etapas são calculadas com os dados atuais.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const client = active.find(item => item.id === clientId) ?? active[0];
  const steps = onboardingSteps(client, meta, reports, analyzedClientIds);
  const completed = steps.filter(step => step.complete).length;
  const next = steps.find(step => !step.complete);
  function remember(value: boolean, selected = clientId) {
    setCollapsed(value);
    try { localStorage.setItem(key, JSON.stringify({ collapsed: value, clientId: selected })); } catch { /* Sem armazenamento, o checklist continua disponível. */ }
  }
  return <section className="panel onboarding-panel" aria-label="Primeiros passos no iGrow">
    <div className="panel-heading"><div><h2><Compass size={20} />{completed === steps.length ? "Tudo pronto para analisar" : "Do primeiro cliente ao primeiro relatório"}</h2><p>{completed} de {steps.length} etapas concluídas · seu progresso acompanha os dados reais</p></div><button className="button button-secondary button-sm" aria-expanded={!collapsed} onClick={() => remember(!collapsed)}>{collapsed ? "Retomar primeiros passos" : "Fazer depois"}{collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button></div>
    {!collapsed && <>
      {active.length > 1 && <label className="onboarding-client">Acompanhar cliente<select className="input" value={client?.id ?? ""} onChange={event => { setClientId(event.target.value); remember(false, event.target.value); }}>{active.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <ol className="onboarding-steps">{steps.map((step, index) => <li key={step.title} className={step.complete ? "complete" : next === step ? "current" : ""}><span>{step.complete ? <CheckCircle2 size={21} /> : <Circle size={21} />}</span><div><strong>{index + 1}. {step.title}</strong><p>{step.description}</p><Link href={step.href}>{step.complete ? "Revisar" : "Continuar"}<ArrowRight size={14} /></Link></div></li>)}</ol>
      <p className="onboarding-note">O PDF é gerado na Visão geral e fica em Relatórios como rascunho. Publicar libera o documento ao cliente. WhatsApp e agendamentos serão configurados separadamente.</p>
    </>}
  </section>;
}
