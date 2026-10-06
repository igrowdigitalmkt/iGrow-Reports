"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, FileText, LayoutTemplate, Send } from "lucide-react";
import { SYSTEM_TEMPLATES } from "@/modules/automations/message";
import { upcomingRuns } from "@/modules/automations/schedule";
import type { AutomationsSnapshot } from "@/modules/automations/types";
import type { ClientItem } from "@/modules/clients/schema";
import { buildDeliveryEntries, DELIVERY_KIND, type DeliveryItem } from "@/modules/whatsapp/deliveries-view";
import "@/modules/automations/automations.css";

const DAY = 86_400_000;

// Relatórios › Visão geral: what was sent, what is coming and where each part lives.
export function ReportsOverview({ base, automations, deliveries, clients, savedTemplates, savedPdfs, timezone }: {
  base: string; automations: AutomationsSnapshot | null; deliveries: DeliveryItem[]; clients: ClientItem[];
  savedTemplates: number; savedPdfs: number | null; timezone: string;
}) {
  const [now] = useState(() => new Date());
  const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const fullFormat = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const clientName = (id: string) => clients.find(client => client.id === id)?.name ?? "Cliente";

  const entries = buildDeliveryEntries(deliveries, automations);
  const recent = entries.filter(entry => now.getTime() - new Date(entry.at).getTime() <= 30 * DAY);
  const problems = recent.filter(entry => entry.status.ok === false).length;
  const active = automations?.automations.filter(item => item.active) ?? [];
  const upcoming = active.flatMap(item => upcomingRuns({ frequency: item.frequency, weekdays: item.weekdays, monthDay: item.monthDay, sendTime: item.sendTime, timezone: item.timezone }, now, 3).map(at => ({ at, item })))
    .sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 5);

  return <div className="reports-overview">
    <div className="delivery-stats reports-overview-stats">
      <div><span>Envios em 30 dias</span><strong>{recent.length}</strong></div>
      <div><span>Com problema</span><strong className={problems ? "is-warn" : undefined}>{problems}</strong></div>
      <div><span>Agendamentos ativos</span><strong>{active.length}</strong></div>
      <div><span>PDFs salvos</span><strong>{savedPdfs ?? "—"}</strong></div>
    </div>

    <div className="by-client-columns">
      <section className="panel">
        <div className="panel-heading"><div><h2>Próximos envios</h2><p>Todos os clientes</p></div><Link className="text-link" href={`${base}/agendamentos`}>Agendamentos<ArrowRight size={14} /></Link></div>
        {upcoming.length ? <ol className="calendar-upcoming">{upcoming.map(run => <li key={run.item.id + run.at.toISOString()}>
          <span className="reports-overview-icon"><CalendarClock size={15} /></span>
          <span><strong>{run.item.name}</strong><small>{clientName(run.item.clientId)} · {fullFormat.format(run.at)}</small></span>
        </li>)}</ol> : <p className="automation-empty-note">Nenhum envio agendado. Crie um em Agendamentos.</p>}
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h2>Últimas entregas</h2><p>Agendadas, enviadas agora e PDFs</p></div><Link className="text-link" href={`${base}/relatorios/entregas`}>Ver todas<ArrowRight size={14} /></Link></div>
        {entries.length ? <ul className="run-list">{entries.slice(0, 5).map(entry => {
          const Icon = DELIVERY_KIND[entry.kind].icon;
          return <li key={entry.id}>
            <span className={`delivery-kind is-${entry.kind}`} title={DELIVERY_KIND[entry.kind].label}><Icon size={15} /></span>
            <span className="run-list-main"><strong>{entry.title}</strong><small>{clientName(entry.clientId)} · {dateTime.format(new Date(entry.at))}</small></span>
            <span className={`badge ${entry.status.tone}`}><span className="status-dot" />{entry.status.label}</span>
          </li>;
        })}</ul> : <p className="automation-empty-note">Nenhum envio ainda.</p>}
      </section>
    </div>

    <div className="reports-overview-links">
      <Link className="panel" href={`${base}/relatorios/entregas`}><Send size={17} /><span><strong>Entregas</strong><small>Histórico de envios de cada cliente</small></span><ArrowRight size={15} /></Link>
      <Link className="panel" href={`${base}/relatorios/templates`}><LayoutTemplate size={17} /><span><strong>Templates</strong><small>{savedTemplates} {savedTemplates === 1 ? "salvo" : "salvos"} · {SYSTEM_TEMPLATES.length} prontos da plataforma</small></span><ArrowRight size={15} /></Link>
      <Link className="panel" href={`${base}/relatorios/pdfs`}><FileText size={17} /><span><strong>PDFs salvos</strong><small>Relatórios em PDF de cada cliente</small></span><ArrowRight size={15} /></Link>
    </div>
  </div>;
}
