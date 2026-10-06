"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CalendarDays, MessageSquareText, Pencil, Plus, QrCode, Send, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RowMenu } from "@/components/ui/row-menu";
import type { ClientItem } from "@/modules/clients/schema";
import type { SendableRecipient } from "@/modules/whatsapp/send-report-dialog";
import type { ReportAutomationRunStatus } from "@/types/database";
import { deleteAutomationAction, setAutomationActiveAction } from "./actions";
import { AutomationEditor, emptyDraft, type EditorDraft } from "./automation-editor";
import { addDays, describeSchedule, localDate, PERIOD_LABELS, upcomingRuns, WEEKDAY_SHORT } from "./schedule";
import type { AutomationItem, AutomationsSnapshot } from "./types";
import "./automations.css";

const RUN_STATUS: Record<ReportAutomationRunStatus, { label: string; tone: string }> = {
  running: { label: "Enviando", tone: "neutral" },
  sent: { label: "Enviado", tone: "green" },
  partial: { label: "Parcial", tone: "amber" },
  failed: { label: "Falhou", tone: "amber" },
  skipped: { label: "Não enviado", tone: "neutral" },
};

export function AutomationsView({ snapshot, clients, recipients, canEdit, timezone, workspaceName, appUrl, channelReady, demo = false }: {
  snapshot: AutomationsSnapshot; clients: ClientItem[]; recipients: SendableRecipient[]; canEdit: boolean; timezone: string;
  workspaceName: string; appUrl: string | null; channelReady: boolean; demo?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditorDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, startBusy] = useTransition();
  const [now] = useState(() => new Date());
  const activeClients = clients.filter(client => !client.archived_at);
  const clientName = (id: string) => clients.find(client => client.id === id)?.name ?? "Cliente";
  const recipientName = (id: string) => recipients.find(recipient => recipient.id === id)?.name ?? "Destinatário";
  const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: timezone });
  const shortDay = (date: Date) => dayFormat.format(date).replace(" de ", " ").replace(".", "");
  const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const fullFormat = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone });

  const ruleOf = (item: AutomationItem) => ({ frequency: item.frequency, weekdays: item.weekdays, monthDay: item.monthDay, sendTime: item.sendTime, timezone: item.timezone });
  const today = localDate(now, timezone);
  const days = Array.from({ length: 14 }, (_, index) => addDays(today, index));
  const calendar = (() => {
    const byDay = new Map<string, Array<{ at: Date; item: AutomationItem }>>();
    for (const item of snapshot.automations.filter(automation => automation.active)) {
      for (const at of upcomingRuns(ruleOf(item), now, 14)) {
        const day = localDate(at, timezone);
        if (day > days[13]) break;
        byDay.set(day, [...(byDay.get(day) ?? []), { at, item }]);
      }
    }
    for (const list of byDay.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
    return byDay;
  })();
  const upcoming = [...calendar.values()].flat().sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 6);

  function act(task: () => Promise<{ error?: string } | { success: true }>) {
    setError("");
    if (demo) { setError("Na demonstração nada é alterado."); return; }
    startBusy(async () => {
      const result = await task();
      if ("error" in result && result.error) setError(result.error);
      router.refresh();
    });
  }

  if (!snapshot.ready) return <section className="panel empty-state"><CalendarClock size={22} /><h3>Agendamentos ainda não instalados</h3><p>O banco de dados deste espaço precisa receber a atualização de agendamentos. Assim que ela for aplicada, esta página passa a funcionar.</p></section>;

  if (editing) return <AutomationEditor draft={editing} clients={activeClients} recipients={recipients} timezone={timezone} workspaceName={workspaceName} appUrl={appUrl} demo={demo} groupsEnabled={channelReady && !demo}
    onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />;

  const create = () => activeClients[0] && setEditing(emptyDraft(activeClients[0].id));
  const edit = (item: AutomationItem) => setEditing({ ...item });

  return <div className="automations">
    {!channelReady && <div className="automation-channel">
      <span className="automation-channel-icon"><QrCode size={18} /></span>
      <div><strong>Os envios automáticos saem do seu próprio WhatsApp</strong><p>A conexão por QR Code ficará em Integrações. Até lá, você já pode criar e revisar os agendamentos: eles ficam salvos e começam a enviar assim que o número for conectado.</p></div>
    </div>}

    {!snapshot.automations.length ? <section className="panel automation-intro">
      <div className="automation-intro-copy">
        <h2>Envie os números para o cliente sem lembrar de enviar</h2>
        <p>Escreva a mensagem uma vez com as variáveis (investimento, alcance, resultados…). Em cada envio elas são preenchidas com os números do período.</p>
        <ol className="automation-intro-steps">
          <li><span><Users size={16} /></span><div><strong>Escolha o cliente e quem recebe</strong><small>Pessoas autorizadas ou grupos do WhatsApp</small></div></li>
          <li><span><MessageSquareText size={16} /></span><div><strong>Escreva a mensagem</strong><small>Veja ao lado exatamente como ela vai chegar</small></div></li>
          <li><span><CalendarDays size={16} /></span><div><strong>Defina quando</strong><small>Diário, em dias da semana ou uma vez por mês</small></div></li>
        </ol>
        {canEdit && <Button onClick={create} disabled={!activeClients.length}><Plus size={15} />Criar o primeiro agendamento</Button>}
        {!activeClients.length && <p className="automation-hint">Cadastre um cliente antes de criar agendamentos.</p>}
      </div>
    </section> : <div className="automations-grid">
      <section className="panel automation-list">
        <div className="panel-heading"><div><h2>Agendamentos</h2><p>{snapshot.automations.filter(item => item.active).length} ativos de {snapshot.automations.length}</p></div>
          {canEdit && <Button size="sm" onClick={create}><Plus size={15} />Novo agendamento</Button>}</div>
        {error && <p role="alert" className="meta-feedback error mx-4">{error}</p>}
        <ul>{snapshot.automations.map(item => {
          const next = item.active ? upcomingRuns(ruleOf(item), now, 1)[0] : null;
          const people = item.targets.filter(target => target.recipientId).map(target => recipientName(target.recipientId!));
          const groups = item.targets.filter(target => target.groupId).map(target => target.groupName!);
          return <li key={item.id} className={item.active ? undefined : "is-paused"}>
            <label className="automation-switch" title={item.active ? "Pausar" : "Ativar"}>
              <input type="checkbox" role="switch" checked={item.active} disabled={!canEdit || busy} onChange={event => act(() => setAutomationActiveAction({ id: item.id, active: event.target.checked }))} />
              <span aria-hidden="true" /><span className="sr-only">{item.active ? "Ativo" : "Pausado"}</span>
            </label>
            <button type="button" className="automation-row" onClick={() => canEdit && edit(item)} disabled={!canEdit}>
              <strong>{item.name}</strong>
              <span>{clientName(item.clientId)} · {PERIOD_LABELS[item.periodKey]}</span>
              <small>{describeSchedule(ruleOf(item))} · {[people.length ? `${people.length === 1 ? people[0] : `${people.length} pessoas`}` : "", groups.length ? `${groups.length} ${groups.length === 1 ? "grupo" : "grupos"}` : ""].filter(Boolean).join(" e ") || "sem destinatários"}</small>
            </button>
            <span className="automation-next-chip">{next ? <><CalendarClock size={13} />{fullFormat.format(next)}</> : "Pausado"}</span>
            {canEdit && <RowMenu label={`Ações de ${item.name}`} items={[
              { label: "Editar", icon: <Pencil size={15} />, onSelect: () => edit(item) },
              { label: "Excluir", icon: <Trash2 size={15} />, danger: true, separatorBefore: true, onSelect: () => { if (window.confirm(`Excluir o agendamento "${item.name}"? O histórico de envios também será apagado.`)) act(() => deleteAutomationAction({ id: item.id })); } },
            ]} />}
          </li>;
        })}</ul>
      </section>

      <section className="panel automation-calendar">
        <div className="panel-heading"><div><h2>Próximas duas semanas</h2><p>Cada ponto é um envio programado</p></div></div>
        <div className="calendar-grid">
          {days.slice(0, 7).map(day => <span key={`h-${day}`} className="calendar-weekday">{WEEKDAY_SHORT[new Date(`${day}T00:00:00Z`).getUTCDay()]}</span>)}
          {days.map(day => {
            const runs = calendar.get(day) ?? [];
            return <div key={day} className={`calendar-day${day === today ? " is-today" : ""}${runs.length ? " has-runs" : ""}`} title={runs.map(run => `${timeFormat.format(run.at)} · ${run.item.name}`).join("\n") || undefined}>
              <span>{Number(day.slice(8))}</span>
              <i>{runs.slice(0, 3).map(run => <b key={run.item.id + run.at.toISOString()} />)}</i>
            </div>;
          })}
        </div>
        <ol className="calendar-upcoming">{upcoming.length ? upcoming.map(run => <li key={run.item.id + run.at.toISOString()}>
          <time>{shortDay(run.at)}<small>{timeFormat.format(run.at)}</small></time>
          <span><strong>{run.item.name}</strong><small>{clientName(run.item.clientId)}</small></span>
        </li>) : <li className="calendar-none">Nenhum envio ativo nas próximas duas semanas.</li>}</ol>
      </section>
    </div>}

    {snapshot.automations.length > 0 && <section className="panel automation-history">
      <div className="panel-heading"><div><h2>Histórico de envios automáticos</h2><p>Cada execução com o texto enviado</p></div></div>
      {snapshot.runs.length ? <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">Execuções dos agendamentos</caption>
        <thead><tr><th scope="col">Quando</th><th scope="col">Agendamento</th><th scope="col">Período</th><th scope="col">Envios</th><th scope="col">Situação</th></tr></thead>
        <tbody>{snapshot.runs.map(run => {
          const item = snapshot.automations.find(automation => automation.id === run.automationId);
          return <tr key={run.id}>
            <td className="mono-date">{fullFormat.format(new Date(run.scheduledFor))}</td>
            <td><div className="client-cell"><span style={{ minWidth: 0 }}><strong>{item?.name ?? "Agendamento"}</strong><small>{item ? clientName(item.clientId) : ""}</small></span></div></td>
            <td>{run.dateFrom && run.dateTo ? `${run.dateFrom.split("-").reverse().join("/")} a ${run.dateTo.split("-").reverse().join("/")}` : "—"}</td>
            <td>{run.sentCount}{run.failedCount ? ` · ${run.failedCount} com falha` : ""}</td>
            <td><span className={`badge ${RUN_STATUS[run.status].tone}`}><span className="status-dot" />{RUN_STATUS[run.status].label}</span>{run.errorMessage && <small className="delivery-error">{run.errorMessage}</small>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="automation-empty-note"><Send size={16} />Nenhum envio automático ainda. As execuções aparecem aqui com o texto e o resultado.</p>}
    </section>}
  </div>;
}
