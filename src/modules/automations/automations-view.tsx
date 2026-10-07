"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarDays, MessageSquareText, Pencil, Plus, QrCode, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowMenu } from "@/components/ui/row-menu";
import type { ClientItem } from "@/modules/clients/schema";
import type { SavedTemplate } from "@/modules/templates/types";
import type { SendableRecipient } from "@/modules/whatsapp/send-report-dialog";
import type { ReportAutomationRunStatus } from "@/types/database";
import { deleteAutomationAction, setAutomationActiveAction } from "./actions";
import { AutomationEditor, emptyDraft, type EditorDraft } from "./automation-editor";
import { ClientRail, rememberClient } from "./client-rail";
import { addDays, describeSchedule, localDate, PERIOD_LABELS, upcomingRuns, WEEKDAY_SHORT } from "./schedule";
import { SendNowButton } from "./send-now";
import type { AutomationItem, AutomationsSnapshot } from "./types";
import "./automations.css";
import type { WhatsAppSummary } from "@/modules/whatsapp/whatsapp-manager";

export const RUN_STATUS: Record<ReportAutomationRunStatus, { label: string; tone: string }> = {
  running: { label: "Enviando", tone: "neutral" },
  sent: { label: "Enviado", tone: "green" },
  partial: { label: "Parcial", tone: "amber" },
  failed: { label: "Falhou", tone: "amber" },
  skipped: { label: "Não enviado", tone: "neutral" },
};

// Schedules split by client: pick a client on the left, see and manage only theirs on the right.
export function AutomationsView({ snapshot, clients, recipients, canEdit, timezone, workspaceName, appUrl, channelReady, demo = false, templates = [], numbers = [], initialClientId }: {
  snapshot: AutomationsSnapshot; clients: ClientItem[]; recipients: SendableRecipient[]; canEdit: boolean; timezone: string;
  workspaceName: string; appUrl: string | null; channelReady: boolean; demo?: boolean; templates?: SavedTemplate[]; numbers?: WhatsAppSummary; initialClientId?: string;
}) {
  const router = useRouter();
  const activeClients = clients.filter(client => !client.archived_at);
  const byClient = (id: string) => snapshot.automations.filter(item => item.clientId === id);
  const firstWithSchedules = activeClients.find(client => byClient(client.id).length)?.id;
  const [clientId, setClientId] = useState<string | null>(
    activeClients.some(client => client.id === initialClientId) ? initialClientId! : firstWithSchedules ?? activeClients[0]?.id ?? null);
  const [editing, setEditing] = useState<EditorDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();
  const [now] = useState(() => new Date());
  const recipientName = (id: string) => recipients.find(recipient => recipient.id === id)?.name ?? "Destinatário";
  const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: timezone });
  const shortDay = (date: Date) => dayFormat.format(date).replace(" de ", " ").replace(".", "");
  const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const fullFormat = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const ruleOf = (item: AutomationItem) => ({ frequency: item.frequency, weekdays: item.weekdays, monthDay: item.monthDay, sendTime: item.sendTime, timezone: item.timezone });

  function act(task: () => Promise<{ error?: string } | { success: true }>) {
    setError("");
    if (demo) { setError("Na demonstração nada é alterado."); return; }
    startBusy(async () => {
      const result = await task();
      if ("error" in result && result.error) setError(result.error);
      router.refresh();
    });
  }
  function select(id: string) { setClientId(id); setError(""); if (!demo) rememberClient(id); }

  if (!snapshot.ready) return <section className="panel empty-state"><CalendarClock size={22} /><h3>Agendamentos ainda não instalados</h3><p>O banco de dados deste espaço precisa receber a atualização de agendamentos. Assim que ela for aplicada, esta página passa a funcionar.</p></section>;

  if (editing) return <AutomationEditor draft={editing} clients={activeClients} recipients={recipients} timezone={timezone} workspaceName={workspaceName} appUrl={appUrl} demo={demo} groupsEnabled={channelReady && !demo} templates={templates} numbers={numbers}
    onCancel={() => setEditing(null)} onSaved={() => { if (editing.clientId) setClientId(editing.clientId); setEditing(null); router.refresh(); }} onSent={() => router.refresh()} />;

  const client = activeClients.find(item => item.id === clientId) ?? null;
  const items = client ? byClient(client.id) : [];
  const runs = snapshot.runs.filter(run => items.some(item => item.id === run.automationId));
  const create = () => client && setEditing(emptyDraft(client.id));
  const edit = (item: AutomationItem) => setEditing({ ...item });

  const today = localDate(now, timezone);
  const days = Array.from({ length: 14 }, (_, index) => addDays(today, index));
  const calendar = new Map<string, Array<{ at: Date; item: AutomationItem }>>();
  for (const item of items.filter(automation => automation.active)) {
    for (const at of upcomingRuns(ruleOf(item), now, 14)) {
      const day = localDate(at, timezone);
      if (day > days[13]) break;
      calendar.set(day, [...(calendar.get(day) ?? []), { at, item }]);
    }
  }
  const upcoming = [...calendar.values()].flat().sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 5);

  return <div className="automations">
    {!channelReady && <div className="automation-channel">
      <span className="automation-channel-icon"><QrCode size={18} /></span>
      <div><strong>Os envios automáticos saem do seu próprio WhatsApp</strong><p>Conecte o número por QR Code em Integrações. Até lá, os agendamentos ficam salvos e começam a enviar assim que o número for conectado.</p></div>
    </div>}

    <div className="by-client">
      <ClientRail title="Clientes" clients={activeClients} selectedId={clientId} onSelect={select} info={id => {
        const list = byClient(id);
        const active = list.filter(item => item.active).length;
        return list.length ? { detail: `${active} ${active === 1 ? "ativo" : "ativos"} de ${list.length}`, count: list.length, tone: active ? "on" : "warn" } : { detail: "Sem agendamentos", tone: "off" };
      }} />

      {!client ? <section className="panel empty-state"><Users size={22} /><h3>Cadastre um cliente</h3><p>Os agendamentos são organizados por cliente. Cadastre o primeiro em Clientes.</p></section> : <div className="by-client-main">
        <header className="by-client-head">
          <div><h2>{client.name}</h2><p>{items.length ? `${items.length} ${items.length === 1 ? "agendamento" : "agendamentos"} · ${items.filter(item => item.active).length} ativos` : "Nenhum agendamento ainda"}</p></div>
          {canEdit && <Button size="sm" onClick={create}><Plus size={15} />Novo agendamento</Button>}
        </header>
        {error && <p role="alert" className="meta-feedback error">{error}</p>}

        {!items.length ? <section className="panel automation-intro">
          <div className="automation-intro-copy">
            <h2>Envie os números de {client.name} sem precisar lembrar</h2>
            <p>Escolha um template ou escreva a mensagem com as variáveis. Em cada envio elas são preenchidas com os números do período.</p>
            <ol className="automation-intro-steps">
              <li><span><MessageSquareText size={16} /></span><div><strong>Escolha o template</strong><small>Conversas, vendas, leads, seguidores… ou o seu</small></div></li>
              <li><span><Users size={16} /></span><div><strong>Escolha quem recebe</strong><small>Pessoas autorizadas ou grupos do WhatsApp</small></div></li>
              <li><span><CalendarDays size={16} /></span><div><strong>Defina quando</strong><small>Diário, em dias da semana ou uma vez por mês</small></div></li>
            </ol>
            {canEdit && <Button onClick={create}><Plus size={15} />Criar agendamento para {client.name}</Button>}
          </div>
        </section> : <>
          <ul className="automation-cards">{items.map(item => {
            const next = item.active ? upcomingRuns(ruleOf(item), now, 1)[0] : null;
            const people = item.targets.filter(target => target.recipientId).map(target => recipientName(target.recipientId!));
            const groups = item.targets.filter(target => target.groupId).length;
            const who = [people.length ? (people.length === 1 ? people[0] : `${people.length} pessoas`) : "", groups ? `${groups} ${groups === 1 ? "grupo" : "grupos"}` : ""].filter(Boolean).join(" e ") || "sem destinatários";
            return <li key={item.id} className={`panel automation-card${item.active ? "" : " is-paused"}`}>
              <div className="automation-card-top">
                <label className="automation-switch" title={item.active ? "Pausar" : "Ativar"}>
                  <input type="checkbox" role="switch" checked={item.active} disabled={!canEdit || busy} onChange={event => act(() => setAutomationActiveAction({ id: item.id, active: event.target.checked }))} />
                  <span aria-hidden="true" /><span className="sr-only">{item.active ? "Ativo" : "Pausado"}</span>
                </label>
                <button type="button" className="automation-row" onClick={() => canEdit && edit(item)} disabled={!canEdit}>
                  <strong>{item.name}</strong>
                  <span>{describeSchedule(ruleOf(item))} · {PERIOD_LABELS[item.periodKey]}</span>
                  <small>Para {who}</small>
                </button>
                {canEdit && <RowMenu label={`Ações de ${item.name}`} items={[
                  { label: "Editar", icon: <Pencil size={15} />, onSelect: () => edit(item) },
                  { label: "Excluir", icon: <Trash2 size={15} />, danger: true, separatorBefore: true, onSelect: () => { if (window.confirm(`Excluir o agendamento "${item.name}"? O histórico de envios também será apagado.`)) act(() => deleteAutomationAction({ id: item.id })); } },
                ]} />}
              </div>
              <div className="automation-card-foot">
                <span className="automation-next-chip">{next ? <><CalendarClock size={13} />Próximo: {fullFormat.format(next)}</> : "Pausado"}</span>
                {canEdit && <SendNowButton size="sm" variant="ghost" prepare={async () => item.id} recipients={item.targets.length} periodLabel={PERIOD_LABELS[item.periodKey]} demo={demo} onDone={() => router.refresh()} />}
              </div>
            </li>;
          })}</ul>

          <div className="by-client-columns">
            <section className="panel automation-calendar">
              <div className="panel-heading"><div><h2>Próximas duas semanas</h2><p>Envios programados de {client.name}</p></div></div>
              <div className="calendar-grid">
                {days.slice(0, 7).map(day => <span key={`h-${day}`} className="calendar-weekday">{WEEKDAY_SHORT[new Date(`${day}T00:00:00Z`).getUTCDay()]}</span>)}
                {days.map(day => {
                  const list = calendar.get(day) ?? [];
                  return <div key={day} className={`calendar-day${day === today ? " is-today" : ""}${list.length ? " has-runs" : ""}`} title={list.map(run => `${timeFormat.format(run.at)} · ${run.item.name}`).join("\n") || undefined}>
                    <span>{Number(day.slice(8))}</span>
                    <i>{list.slice(0, 3).map(run => <b key={run.item.id + run.at.toISOString()} />)}</i>
                  </div>;
                })}
              </div>
              <ol className="calendar-upcoming">{upcoming.length ? upcoming.map(run => <li key={run.item.id + run.at.toISOString()}>
                <time>{shortDay(run.at)}<small>{timeFormat.format(run.at)}</small></time>
                <span><strong>{run.item.name}</strong><small>{PERIOD_LABELS[run.item.periodKey]}</small></span>
              </li>) : <li className="calendar-none">Nenhum envio ativo nas próximas duas semanas.</li>}</ol>
            </section>

            <section className="panel automation-history">
              <div className="panel-heading"><div><h2>Últimos envios</h2><p>Histórico completo em Relatórios › Entregas</p></div></div>
              {runs.length ? <ul className="run-list">{runs.slice(0, 8).map(run => {
                const item = items.find(automation => automation.id === run.automationId);
                return <li key={run.id}>
                  <span className={`badge ${RUN_STATUS[run.status].tone}`}><span className="status-dot" />{RUN_STATUS[run.status].label}</span>
                  <span className="run-list-main"><strong>{item?.name ?? "Agendamento"}</strong><small>{fullFormat.format(new Date(run.scheduledFor))}{run.trigger === "manual" ? " · enviado agora" : ""}{run.sentCount ? ` · ${run.sentCount} ${run.sentCount === 1 ? "mensagem" : "mensagens"}` : ""}</small>{run.errorMessage && <small className="delivery-error">{run.errorMessage}</small>}</span>
                </li>;
              })}</ul> : <p className="automation-empty-note">Nenhum envio ainda para este cliente.</p>}
            </section>
          </div>
        </>}
      </div>}
    </div>
  </div>;
}
