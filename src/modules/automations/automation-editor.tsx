"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, CircleAlert, Loader2, Search, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientItem } from "@/modules/clients/schema";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { SendableRecipient } from "@/modules/whatsapp/send-report-dialog";
import type { ReportFrequency, ReportPeriodKey } from "@/types/database";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { previewAutomationDataAction, saveAutomationAction } from "./actions";
import { MESSAGE_PRESETS, MESSAGE_VARIABLES, renderMessage, unknownVariables } from "./message";
import { describeSchedule, PERIOD_LABELS, upcomingRuns, WEEKDAY_SHORT } from "./schedule";
import type { AutomationItem } from "./types";
import { WhatsAppPreview } from "./whatsapp-preview";

export type EditorDraft = Omit<AutomationItem, "id" | "nextRunAt" | "lastRunAt" | "timezone"> & { id?: string };

export function emptyDraft(clientId: string): EditorDraft {
  return {
    clientId, name: "Resumo semanal", messageTemplate: MESSAGE_PRESETS[0].text, periodKey: "last_7d", frequency: "weekly",
    weekdays: [1], monthDay: 1, sendTime: "08:00", active: true, targets: [],
  };
}

const FREQUENCIES: Array<{ key: ReportFrequency; label: string }> = [
  { key: "daily", label: "Diário" }, { key: "weekly", label: "Semanal" }, { key: "monthly", label: "Mensal" },
];
const GROUPS = ["Geral", "Investimento", "Alcance", "Resultados"] as const;
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// One screen: who, what, when on the left; the message exactly as it will arrive on the right.
export function AutomationEditor({ draft: initial, clients, recipients, timezone, workspaceName, appUrl, demo = false, groupsEnabled = false, onCancel, onSaved }: {
  draft: EditorDraft; demo?: boolean; groupsEnabled?: boolean; clients: ClientItem[]; recipients: SendableRecipient[]; timezone: string; workspaceName: string; appUrl: string | null;
  onCancel: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [saving, startSaving] = useTransition();
  const [preview, setPreview] = useState<{ key: string; data: AnalyticsDashboardData | null; error?: string } | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [groups, setGroups] = useState<Array<{ id: string; subject: string; size: number | null }> | null>(null);
  const [groupError, setGroupError] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const update = (patch: Partial<EditorDraft>) => setDraft(current => ({ ...current, ...patch }));

  const client = clients.find(item => item.id === draft.clientId);
  const clientRecipients = recipients.filter(recipient => recipient.clientId === draft.clientId);
  const selectedIds = draft.targets.flatMap(target => target.recipientId ? [target.recipientId] : []);
  const firstRecipient = clientRecipients.find(recipient => selectedIds.includes(recipient.id));
  const unknown = unknownVariables(draft.messageTemplate);
  const previewKey = `${draft.clientId}:${draft.periodKey}`;

  useEffect(() => {
    if (!draft.clientId) return;
    let cancelled = false;
    const load = demo ? Promise.resolve({ success: true as const, data: getDemoClientAnalytics() }) : previewAutomationDataAction({ clientId: draft.clientId, periodKey: draft.periodKey });
    load.then(result => {
      if (!cancelled) setPreview({ key: previewKey, data: "data" in result ? result.data ?? null : null, error: "error" in result ? result.error : undefined });
    });
    return () => { cancelled = true; };
  }, [draft.clientId, draft.periodKey, previewKey, demo]);

  // Groups come live from the connected number; saved groups stay listed even if the fetch fails.
  useEffect(() => {
    if (!groupsEnabled) return;
    let cancelled = false;
    fetch("/api/whatsapp/qr/groups", { cache: "no-store" }).then(response => response.json()).then((body: { groups?: Array<{ id: string; subject: string; size: number | null }>; error?: string }) => {
      if (cancelled) return;
      if (body.groups) setGroups(body.groups); else setGroupError(body.error ?? "Não foi possível listar os grupos.");
    }).catch(() => { if (!cancelled) setGroupError("Não foi possível listar os grupos."); });
    return () => { cancelled = true; };
  }, [groupsEnabled]);

  const loading = preview?.key !== previewKey;
  const rendered = renderMessage(draft.messageTemplate, {
    clientName: client?.name ?? "Cliente", recipientName: firstRecipient?.name ?? "Maria", workspaceName,
    dashboardUrl: appUrl ? `${appUrl}/cliente/${draft.clientId}` : null, data: loading ? null : preview?.data ?? null,
  });

  const rule = { frequency: draft.frequency, weekdays: draft.weekdays, monthDay: draft.monthDay, sendTime: draft.sendTime, timezone };
  const [now] = useState(() => new Date());
  const nextRuns = upcomingRuns(rule, now, 3);
  const when = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone });

  function insertVariable(key: string) {
    const element = textarea.current;
    const token = `{{${key}}}`;
    const start = element?.selectionStart ?? draft.messageTemplate.length;
    const end = element?.selectionEnd ?? start;
    update({ messageTemplate: draft.messageTemplate.slice(0, start) + token + draft.messageTemplate.slice(end) });
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + token.length, start + token.length); });
  }

  const selectedGroups = draft.targets.flatMap(target => target.groupId ? [{ id: target.groupId, subject: target.groupName, size: null }] : []);
  const groupOptions = [...selectedGroups.filter(group => !groups?.some(item => item.id === group.id)), ...(groups ?? [])]
    .filter(group => !groupQuery || group.subject.toLowerCase().includes(groupQuery.toLowerCase()));
  function toggleGroup(group: { id: string; subject: string }) {
    const on = draft.targets.some(target => target.groupId === group.id);
    update({ targets: on ? draft.targets.filter(target => target.groupId !== group.id) : [...draft.targets, { groupId: group.id, groupName: group.subject }] });
  }

  function toggleRecipient(id: string) {
    const targets = selectedIds.includes(id) ? draft.targets.filter(target => target.recipientId !== id) : [...draft.targets, { recipientId: id }];
    update({ targets });
  }

  function save() {
    setError("");
    if (demo) { setError("Na demonstração nada é salvo. Entre no seu espaço para criar agendamentos de verdade."); return; }
    startSaving(async () => {
      const result = await saveAutomationAction({
        id: draft.id, clientId: draft.clientId, name: draft.name, messageTemplate: draft.messageTemplate, periodKey: draft.periodKey,
        frequency: draft.frequency, weekdays: draft.weekdays, monthDay: draft.monthDay, sendTime: draft.sendTime, active: draft.active,
        recipientIds: selectedIds, groups: draft.targets.flatMap(target => target.groupId ? [{ id: target.groupId, name: target.groupName }] : []),
      });
      if ("error" in result && result.error) { setError(result.error); return; }
      onSaved();
    });
  }

  return <div className="automation-editor">
    <div className="automation-editor-head">
      <button type="button" className="button button-ghost button-sm" onClick={onCancel}><ArrowLeft size={15} />Agendamentos</button>
      <h2>{draft.id ? "Editar agendamento" : "Novo agendamento"}</h2>
    </div>

    <div className="automation-editor-grid">
      <div className="automation-steps">
        <section className="panel automation-step">
          <header><span className="step-number">1</span><div><h3>Cliente</h3><p>De quem são os números enviados.</p></div></header>
          <div className="automation-fields two">
            <label><span>Cliente</span>
              <select className="input" value={draft.clientId} onChange={event => update({ clientId: event.target.value, targets: [] })}>
                {clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label><span>Nome do agendamento</span>
              <input className="input" value={draft.name} maxLength={120} onChange={event => update({ name: event.target.value })} placeholder="Ex.: Resumo de segunda" />
            </label>
          </div>
        </section>

        <section className="panel automation-step">
          <header><span className="step-number">2</span><div><h3>Mensagem</h3><p>Clique numa variável para inseri-la onde está o cursor. Use *asteriscos* para negrito.</p></div>
            <select className="input compact-select" aria-label="Começar de um modelo" value="" onChange={event => { const preset = MESSAGE_PRESETS.find(item => item.name === event.target.value); if (preset) update({ messageTemplate: preset.text }); }}>
              <option value="">Usar um modelo…</option>
              {MESSAGE_PRESETS.map(preset => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
            </select>
          </header>
          <div className="variable-groups">{GROUPS.map(group => <div key={group} className="variable-group">
            <span>{group}</span>
            <div>{MESSAGE_VARIABLES.filter(variable => variable.group === group).map(variable =>
              <button key={variable.key} type="button" className="variable-chip" title={`Insere {{${variable.key}}}`} onClick={() => insertVariable(variable.key)}>{variable.label}</button>)}</div>
          </div>)}</div>
          <textarea ref={textarea} className="input automation-message" rows={12} value={draft.messageTemplate} maxLength={4000} onChange={event => update({ messageTemplate: event.target.value })} aria-label="Texto da mensagem" />
          <div className="automation-message-foot">
            {unknown.length ? <span className="is-warn"><CircleAlert size={14} />Variável desconhecida: {unknown.map(key => `{{${key}}}`).join(", ")}</span> : <span>As variáveis são preenchidas com os números do período na hora do envio.</span>}
            <span>{draft.messageTemplate.length}/4000</span>
          </div>
        </section>

        <section className="panel automation-step">
          <header><span className="step-number">3</span><div><h3>Quem recebe</h3><p>Somente destinatários com autorização de recebimento.</p></div></header>
          {clientRecipients.length ? <ul className="automation-recipients">{clientRecipients.map(recipient => <li key={recipient.id}>
            <label className={recipient.authorized ? undefined : "is-disabled"}>
              <input type="checkbox" disabled={!recipient.authorized} checked={selectedIds.includes(recipient.id)} onChange={() => toggleRecipient(recipient.id)} />
              <span><strong>{recipient.name}</strong><small>{recipient.phone}{recipient.reason ? ` · ${recipient.reason}` : ""}</small></span>
            </label>
          </li>)}</ul> : <p className="automation-empty-note"><Users size={16} />Este cliente ainda não tem destinatários. Cadastre em Clientes › Destinatários.</p>}
          {groupsEnabled ? <div className="automation-groups">
            <div className="automation-groups-head"><strong>Grupos do WhatsApp</strong>
              {(groups?.length ?? 0) > 8 && <label className="automation-group-search"><Search size={14} /><input className="input" placeholder="Buscar grupo" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} aria-label="Buscar grupo" /></label>}</div>
            {groups === null && !groupError ? <p className="automation-hint"><Loader2 size={14} className="spin" />Carregando os grupos do seu WhatsApp…</p>
              : groupOptions.length ? <ul className="automation-recipients">{groupOptions.map(group => <li key={group.id}>
                <label><input type="checkbox" checked={draft.targets.some(target => target.groupId === group.id)} onChange={() => toggleGroup(group)} />
                  <span><strong>{group.subject}</strong><small>{group.size ? `${group.size} participantes` : "Grupo"}</small></span></label>
              </li>)}</ul> : <p className="automation-hint">{groupError || (groupQuery ? "Nenhum grupo com esse nome." : "Este número não participa de nenhum grupo.")}</p>}
          </div> : <p className="automation-hint"><Sparkles size={14} />Grupos do WhatsApp aparecem aqui depois que você conectar seu número por QR Code em Integrações.</p>}
        </section>

        <section className="panel automation-step">
          <header><span className="step-number">4</span><div><h3>Quando</h3><p>{describeSchedule(rule)} · horário de {timezone.replace("America/", "").replace("_", " ")}</p></div></header>
          <div className="automation-fields">
            <div className="automation-field-row">
              <span className="field-label">Frequência</span>
              <div className="segmented" role="group" aria-label="Frequência">{FREQUENCIES.map(item =>
                <button key={item.key} type="button" aria-pressed={draft.frequency === item.key} onClick={() => update({ frequency: item.key, periodKey: item.key === "daily" ? "yesterday" : item.key === "monthly" ? "last_month" : draft.periodKey === "yesterday" || draft.periodKey === "last_month" ? "last_7d" : draft.periodKey })}>{item.label}</button>)}</div>
            </div>
            {draft.frequency === "weekly" && <div className="automation-field-row">
              <span className="field-label">Dias</span>
              <div className="weekday-picker" role="group" aria-label="Dias da semana">{WEEK_ORDER.map(day =>
                <button key={day} type="button" aria-pressed={draft.weekdays.includes(day)} onClick={() => update({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter(item => item !== day) : [...draft.weekdays, day] })}>{WEEKDAY_SHORT[day]}</button>)}</div>
            </div>}
            <div className="automation-fields three">
              {draft.frequency === "monthly" && <label><span>Dia do mês</span>
                <select className="input" value={draft.monthDay} onChange={event => update({ monthDay: Number(event.target.value) })}>
                  {Array.from({ length: 28 }, (_, index) => index + 1).map(day => <option key={day} value={day}>Dia {day}</option>)}
                </select>
              </label>}
              <label><span>Horário</span><input className="input" type="time" step={300} value={draft.sendTime} onChange={event => update({ sendTime: event.target.value.slice(0, 5) })} /></label>
              <label><span>Período dos números</span>
                <select className="input" value={draft.periodKey} onChange={event => update({ periodKey: event.target.value as ReportPeriodKey })}>
                  {Object.entries(PERIOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>
          </div>
        </section>
      </div>

      <aside className="automation-preview">
        <div className="automation-preview-sticky">
          <div className="automation-preview-head"><h3>Como vai chegar</h3>{loading ? <span className="badge neutral">Carregando números…</span> : preview?.error ? <span className="badge amber">Sem números</span> : <span className="badge green">Números reais · {PERIOD_LABELS[draft.periodKey].toLowerCase()}</span>}</div>
          <WhatsAppPreview text={rendered} contact={firstRecipient?.name ?? client?.name ?? "Contato"} time={draft.sendTime} loading={loading} />
          {preview?.error && !loading && <p className="automation-hint is-warn"><CircleAlert size={14} />{preview.error}</p>}
          <div className="automation-next">
            <h4>Próximos envios</h4>
            {nextRuns.length ? <ol>{nextRuns.map(run => <li key={run.toISOString()}>{when.format(run)}</li>)}</ol> : <p>Escolha ao menos um dia da semana.</p>}
          </div>
          {error && <p role="alert" className="meta-feedback error">{error}</p>}
          <label className="automation-active"><input type="checkbox" checked={draft.active} onChange={event => update({ active: event.target.checked })} /><span>Ativo — enviar automaticamente nos horários acima</span></label>
          <div className="automation-save">
            <Button variant="secondary" onClick={onCancel} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !draft.clientId}>{saving ? "Salvando…" : draft.id ? "Salvar alterações" : "Criar agendamento"}</Button>
          </div>
        </div>
      </aside>
    </div>
  </div>;
}
