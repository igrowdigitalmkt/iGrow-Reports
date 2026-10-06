"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, FileText, Mail, MessageCircle } from "lucide-react";
import { upcomingRuns } from "@/modules/automations/schedule";
import type { AutomationsSnapshot } from "@/modules/automations/types";
import type { ClientItem } from "@/modules/clients/schema";
import { buildDeliveryEntries, DELIVERY_KIND, type DeliveryEntry, type DeliveryItem } from "@/modules/whatsapp/deliveries-view";
import "@/modules/automations/automations.css";

const DAY = 86_400_000;
type Funnel = { sent: number; delivered: number; read: number; tracked: boolean };

function funnelOf(entries: DeliveryEntry[]): Funnel {
  const withReceipts = entries.filter(entry => entry.receipts);
  return {
    sent: withReceipts.reduce((total, entry) => total + entry.receipts!.total, 0) || entries.length,
    delivered: withReceipts.reduce((total, entry) => total + entry.receipts!.delivered, 0),
    read: withReceipts.reduce((total, entry) => total + entry.receipts!.read, 0),
    tracked: withReceipts.length > 0,
  };
}
const percent = (part: number, whole: number) => whole ? `${Math.round(part / whole * 100)}%` : "—";

function ChannelCard({ icon: Icon, title, description, funnel, soon }: { icon: typeof Mail; title: string; description: string; funnel: Funnel | null; soon?: boolean }) {
  return <section className={`panel channel-card${soon ? " is-soon" : ""}`}>
    <header><span className="channel-card-icon"><Icon size={16} /></span><div><h3>{title}</h3><p>{description}</p></div>{soon && <span className="badge neutral">Em breve</span>}</header>
    {funnel && !soon ? <dl className="channel-funnel">
      <div><dt>Enviados</dt><dd>{funnel.sent}</dd></div>
      <div><dt>Recebidos</dt><dd>{funnel.tracked ? funnel.delivered : "—"}<small>{funnel.tracked ? percent(funnel.delivered, funnel.sent) : "sem confirmação"}</small></dd></div>
      <div><dt>Lidos</dt><dd>{funnel.tracked ? funnel.read : "—"}<small>{funnel.tracked ? percent(funnel.read, funnel.sent) : ""}</small></dd></div>
    </dl> : <p className="channel-card-soon">{soon ? "O envio do relatório por e-mail, com layout próprio e o PDF em anexo, chega em breve." : "Nenhum envio nos últimos 30 dias."}</p>}
  </section>;
}

// Relatórios › Dados gerais: what reached each client and whether they read it.
export function ReportsOverview({ base, automations, deliveries, clients, timezone }: {
  base: string; automations: AutomationsSnapshot | null; deliveries: DeliveryItem[]; clients: ClientItem[];
  timezone: string;
}) {
  const [now] = useState(() => new Date());
  const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const fullFormat = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const clientName = (id: string) => clients.find(client => client.id === id)?.name ?? "Cliente";

  const entries = buildDeliveryEntries(deliveries, automations);
  const recent = entries.filter(entry => now.getTime() - new Date(entry.at).getTime() <= 30 * DAY);
  const messages = recent.filter(entry => entry.kind !== "pdf");
  const pdfs = recent.filter(entry => entry.kind === "pdf");
  const active = automations?.automations.filter(item => item.active) ?? [];
  const upcoming = active.flatMap(item => upcomingRuns({ frequency: item.frequency, weekdays: item.weekdays, monthDay: item.monthDay, sendTime: item.sendTime, timezone: item.timezone }, now, 3).map(at => ({ at, item })))
    .sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 5);
  const byClient = [...new Set(recent.map(entry => entry.clientId))].map(id => {
    const list = recent.filter(entry => entry.clientId === id);
    return { id, name: clientName(id), funnel: funnelOf(list), last: list[0] };
  }).sort((a, b) => b.last.at.localeCompare(a.last.at));

  return <div className="reports-overview">
    <div className="channel-cards">
      <ChannelCard icon={MessageCircle} title="Mensagem de WhatsApp" description="Relatório em texto pelo seu número, últimos 30 dias" funnel={messages.length ? funnelOf(messages) : null} />
      <ChannelCard icon={FileText} title="WhatsApp + PDF" description="Mensagem com o relatório em PDF pela API oficial" funnel={pdfs.length ? funnelOf(pdfs) : null} />
      <ChannelCard icon={Mail} title="E-mail + PDF" description="E-mail com layout próprio e o PDF anexo" funnel={null} soon />
    </div>

    <section className="panel" style={{ overflow: "hidden" }}>
      <div className="panel-heading"><div><h2>Por cliente</h2><p>Quem recebeu e quem leu os relatórios nos últimos 30 dias</p></div><Link className="text-link" href={`${base}/relatorios/entregas`}>Ver entregas<ArrowRight size={14} /></Link></div>
      {byClient.length ? <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">Recebimento e leitura dos relatórios por cliente</caption>
        <thead><tr><th scope="col">Cliente</th><th scope="col" className="numeric">Enviados</th><th scope="col" className="numeric">Recebidos</th><th scope="col" className="numeric">Lidos</th><th scope="col">Último envio</th></tr></thead>
        <tbody>{byClient.map(row => <tr key={row.id}>
          <th scope="row" style={{ fontWeight: 500 }}>{row.name}</th>
          <td className="numeric">{row.funnel.sent}</td>
          <td className="numeric">{row.funnel.tracked ? <>{row.funnel.delivered} <small className="muted">{percent(row.funnel.delivered, row.funnel.sent)}</small></> : "—"}</td>
          <td className="numeric">{row.funnel.tracked ? <>{row.funnel.read} <small className="muted">{percent(row.funnel.read, row.funnel.sent)}</small></> : "—"}</td>
          <td><div className="client-cell"><span style={{ minWidth: 0 }}><strong>{row.last.title}</strong><small>{dateTime.format(new Date(row.last.at))} · {DELIVERY_KIND[row.last.kind].label}</small></span></div></td>
        </tr>)}</tbody>
      </table></div> : <p className="automation-empty-note">Nenhum relatório enviado nos últimos 30 dias.</p>}
    </section>

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
            <span className="run-list-main"><strong>{entry.title}</strong><small>{clientName(entry.clientId)} · {dateTime.format(new Date(entry.at))}{entry.receipts ? ` · ${entry.receipts.read} de ${entry.receipts.total} ${entry.receipts.read === 1 ? "lida" : "lidas"}` : ""}</small></span>
            <span className={`badge ${entry.status.tone}`}><span className="status-dot" />{entry.status.label}</span>
          </li>;
        })}</ul> : <p className="automation-empty-note">Nenhum envio ainda.</p>}
      </section>
    </div>
  </div>;
}
