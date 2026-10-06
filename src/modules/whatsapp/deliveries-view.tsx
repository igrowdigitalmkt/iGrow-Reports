"use client";

import { useState } from "react";
import { CalendarClock, FileText, Send, Zap } from "lucide-react";
import { ClientRail, rememberClient } from "@/modules/automations/client-rail";
import type { AutomationsSnapshot } from "@/modules/automations/types";
import type { ClientItem } from "@/modules/clients/schema";
import type { ReportAutomationRunStatus, ReportDeliveryStatus } from "@/types/database";
import "@/modules/automations/automations.css";

export type DeliveryItem = {
  id: string; clientId: string; createdAt: string; statusAt: string; status: ReportDeliveryStatus; errorMessage: string | null; errorCode: string | null;
  clientName: string; recipientName: string; recipientPhone: string; reportTitle: string; period: string | null;
};

const PDF_STATUS: Record<ReportDeliveryStatus, { label: string; tone: string; ok: boolean | null }> = {
  pending: { label: "Na fila", tone: "neutral", ok: null },
  sending: { label: "Enviando", tone: "neutral", ok: null },
  accepted: { label: "Aceito pelo WhatsApp", tone: "blue", ok: null },
  sent: { label: "Enviado", tone: "blue", ok: true },
  delivered: { label: "Entregue", tone: "green", ok: true },
  read: { label: "Lido", tone: "green", ok: true },
  failed: { label: "Falhou", tone: "amber", ok: false },
  uncertain: { label: "Sem confirmação", tone: "amber", ok: false },
  cancelled: { label: "Cancelado", tone: "neutral", ok: null },
};
const RUN_STATUS: Record<ReportAutomationRunStatus, { label: string; tone: string; ok: boolean | null }> = {
  running: { label: "Enviando", tone: "neutral", ok: null },
  sent: { label: "Enviado", tone: "green", ok: true },
  partial: { label: "Parcial", tone: "amber", ok: false },
  failed: { label: "Falhou", tone: "amber", ok: false },
  skipped: { label: "Não enviado", tone: "neutral", ok: false },
};

// Most common WhatsApp Cloud API failures, in plain language with the action to take.
const ERRORS: Record<string, string> = {
  "131042": "A conta do WhatsApp está sem forma de pagamento válida. Configure o pagamento no Gerenciador do WhatsApp.",
  "131026": "O número não pôde receber a mensagem (sem WhatsApp, bloqueado ou versão antiga).",
  "131047": "Fora da janela de 24 horas: é preciso usar uma mensagem modelo aprovada.",
  "131049": "A Meta limitou envios para este destinatário. Tente mais tarde.",
  "131051": "Tipo de mensagem não suportado.",
  "131053": "Não foi possível enviar o arquivo PDF.",
  "132000": "As variáveis não correspondem à mensagem modelo.",
  "132001": "A mensagem modelo não existe ou não está aprovada neste idioma.",
  "133010": "O número de envio não está registrado na API.",
  "368": "A conta foi restringida por violar políticas do WhatsApp.",
};
export const deliveryErrorText = (code: string | null, message: string | null) => (code && ERRORS[code]) || message;

type Entry = {
  id: string; clientId: string; at: string; kind: "schedule" | "manual" | "pdf"; title: string; detail: string;
  status: { label: string; tone: string; ok: boolean | null }; error: string | null; text: string | null;
};

const KIND = {
  schedule: { label: "Agendado", icon: CalendarClock },
  manual: { label: "Enviado agora", icon: Zap },
  pdf: { label: "PDF", icon: FileText },
};

const brDate = (value: string) => value.split("-").reverse().join("/");

// Every send of each client in one history: scheduled messages, "Enviar agora" and report PDFs.
export function DeliveriesView({ deliveries, automations, clients, connected, timezone = "America/Sao_Paulo", initialClientId }: {
  deliveries: DeliveryItem[]; automations: AutomationsSnapshot | null; clients: ClientItem[]; connected: boolean; timezone?: string; initialClientId?: string;
}) {
  const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const entries: Entry[] = [
    ...(automations?.runs ?? []).flatMap(run => {
      const item = automations?.automations.find(automation => automation.id === run.automationId);
      if (!item) return [];
      const count = run.sentCount + run.failedCount;
      return [{
        id: `run-${run.id}`, clientId: item.clientId, at: run.scheduledFor, kind: run.trigger === "manual" ? "manual" as const : "schedule" as const, title: item.name,
        detail: [run.dateFrom && run.dateTo ? `Números de ${brDate(run.dateFrom)} a ${brDate(run.dateTo)}` : "", count ? `${run.sentCount} de ${count} ${count === 1 ? "mensagem" : "mensagens"}` : ""].filter(Boolean).join(" · "),
        status: RUN_STATUS[run.status], error: run.errorMessage, text: run.messageText,
      }];
    }),
    ...deliveries.map(item => ({
      id: `pdf-${item.id}`, clientId: item.clientId, at: item.createdAt, kind: "pdf" as const, title: item.reportTitle,
      detail: [`Para ${item.recipientName}`, item.period].filter(Boolean).join(" · "),
      status: PDF_STATUS[item.status], error: item.errorMessage ? deliveryErrorText(item.errorCode, item.errorMessage) : null, text: null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const activeClients = clients.filter(client => !client.archived_at || entries.some(entry => entry.clientId === client.id));
  const of = (id: string) => entries.filter(entry => entry.clientId === id);
  const first = activeClients.find(client => of(client.id).length)?.id;
  const [clientId, setClientId] = useState<string | null>(activeClients.some(client => client.id === initialClientId) ? initialClientId! : first ?? activeClients[0]?.id ?? null);
  const [open, setOpen] = useState<string | null>(null);

  if (!entries.length && !activeClients.length) return <section className="panel empty-state"><Send size={22} /><h3>Nenhum envio ainda</h3><p>{connected ? "Os envios dos agendamentos e dos relatórios aparecem aqui." : "Conecte o WhatsApp em Integrações para começar a enviar."}</p></section>;

  const client = activeClients.find(item => item.id === clientId) ?? null;
  const list = client ? of(client.id) : [];
  const ok = list.filter(entry => entry.status.ok === true).length;
  const problems = list.filter(entry => entry.status.ok === false).length;

  return <div className="by-client">
    <ClientRail title="Clientes" clients={activeClients} selectedId={clientId} onSelect={id => { setClientId(id); setOpen(null); rememberClient(id); }} info={id => {
      const items = of(id);
      if (!items.length) return { detail: "Nenhum envio", tone: "off" };
      const last = items[0];
      return { detail: `Último: ${dateTime.format(new Date(last.at))}`, count: items.length, tone: last.status.ok === false ? "warn" : "on" };
    }} />

    {client && <div className="by-client-main">
      <header className="by-client-head"><div><h2>{client.name}</h2><p>{list.length ? `${list.length} ${list.length === 1 ? "envio" : "envios"} registrados` : "Nenhum envio registrado"}</p></div></header>
      {list.length > 0 && <div className="delivery-stats">
        <div><span>Envios</span><strong>{list.length}</strong></div>
        <div><span>Com sucesso</span><strong>{ok}</strong></div>
        <div><span>Com problema</span><strong className={problems ? "is-warn" : undefined}>{problems}</strong></div>
      </div>}
      {list.length ? <ul className="panel delivery-timeline">{list.map(entry => {
        const Icon = KIND[entry.kind].icon;
        return <li key={entry.id}>
          <span className={`delivery-kind is-${entry.kind}`} title={KIND[entry.kind].label}><Icon size={15} /></span>
          <div className="delivery-main">
            <div className="delivery-line"><strong>{entry.title}</strong><span className={`badge ${entry.status.tone}`}><span className="status-dot" />{entry.status.label}</span></div>
            <small>{dateTime.format(new Date(entry.at))} · {KIND[entry.kind].label}{entry.detail ? ` · ${entry.detail}` : ""}</small>
            {entry.error && <small className="delivery-error">{entry.error}</small>}
            {entry.text && <button type="button" className="delivery-toggle" onClick={() => setOpen(open === entry.id ? null : entry.id)} aria-expanded={open === entry.id}>{open === entry.id ? "Ocultar mensagem" : "Ver mensagem enviada"}</button>}
            {entry.text && open === entry.id && <pre className="delivery-text">{entry.text}</pre>}
          </div>
        </li>;
      })}</ul> : <section className="panel empty-state"><Send size={22} /><h3>Nenhum envio para {client.name}</h3><p>Crie um agendamento em Relatórios › Agendamentos ou use “Enviar agora”.</p></section>}
    </div>}
  </div>;
}
