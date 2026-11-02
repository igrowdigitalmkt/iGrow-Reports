"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BellRing, Clock, Plus, Send, TriangleAlert, X } from "lucide-react";
import { removeAlertRecipientAction, saveAlertRecipientAction, sendAlertTestAction, setAlertRecipientActiveAction, type AlertsResult } from "./alerts-actions";
import type { AlertRecipientView, AlertsSnapshot } from "./alerts-admin";
import { WEEKDAY_NAMES } from "./alerts-core";
import { formatPhone, type BoardCampaign, type BoardForm } from "./hub-types";
import "./lead-feed.css";

const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const KIND_LABEL = { instant: "Aviso", digest: "Resumo", test: "Teste" } as const;
const STATUS_LABEL = { sent: "Enviado", failed: "Falhou", skipped: "Sem leads" } as const;

type Draft = { id?: string; name: string; phone: string; mode: "instant" | "scheduled"; times: string[]; weekdays: number[]; campaignIds: string[]; formIds: string[]; consent: boolean };
const EMPTY_DRAFT: Draft = { name: "", phone: "", mode: "instant", times: [], weekdays: ALL_DAYS, campaignIds: [], formIds: [], consent: false };

const describeDays = (days: number[]) => days.length === 7 ? "todos os dias" : days.join(",") === "1,2,3,4,5" ? "dias úteis" : days.map(day => WEEKDAY_NAMES[day]).join(", ");
const describeRule = (item: AlertRecipientView) => item.mode === "instant" ? "Na hora, a cada lead novo" : `Resumo às ${item.sendTimes.join(", ")} (${describeDays(item.weekdays)})`;

/** Alertas de lead novo por WhatsApp: quem recebe, de quais campanhas/formulários e se é na hora ou em horários fixos. */
export function LeadsAlerts({ clientId, initial, campaigns, forms }: { clientId: string; initial: AlertsSnapshot; campaigns: BoardCampaign[]; forms: BoardForm[] }) {
  const [data, setData] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newTime, setNewTime] = useState("09:00");
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = (action: () => Promise<AlertsResult>, options: { busy?: string; close?: boolean } = {}) => {
    setError(""); setNotice(""); setBusy(options.busy ?? null);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (!result.ok) { setError(result.message); return; }
      setData({ recipients: result.recipients, sender: result.sender });
      if (result.message) setNotice(result.message);
      if (options.close) setDraft(null);
    });
  };
  const edit = (item: AlertRecipientView) => { setNotice(""); setError(""); setDraft({ id: item.id, name: item.name, phone: formatPhone(item.phone), mode: item.mode, times: item.sendTimes, weekdays: item.weekdays, campaignIds: item.campaignIds ?? [], formIds: item.formIds ?? [], consent: false }); };
  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  const addTime = () => setDraft(current => current && /^([01]\d|2[0-3]):[0-5]\d$/.test(newTime) && !current.times.includes(newTime) && current.times.length < 12 ? { ...current, times: [...current.times, newTime].sort() } : current);
  const save = () => { if (!draft) return; run(() => saveAlertRecipientAction({ clientId, id: draft.id, name: draft.name, phone: draft.phone, mode: draft.mode, sendTimes: draft.times, weekdays: draft.weekdays,
    campaignIds: draft.campaignIds.length ? draft.campaignIds : null, formIds: draft.formIds.length ? draft.formIds : null, consent: draft.consent }), { close: true }); };

  return <div className="leads-alerts">
    {data.sender !== "connected" && <p className="lead-notice-line is-warn" role="status"><TriangleAlert size={14} />{data.sender === "not_configured" ? "O envio por WhatsApp não está configurado neste ambiente." : <>O WhatsApp da Groow não está conectado. <Link href="/integracoes">Conecte por QR Code em Integrações</Link> para os alertas serem enviados.</>}</p>}
    {error && <p role="alert" className="lead-error">{error}</p>}
    {notice && <p role="status" className="lead-notice-line">{notice}</p>}

    <section className="lead-panel" aria-labelledby="alerts-title">
      <header><div><h2 id="alerts-title">Alertas de lead novo</h2><p>Avise sua equipe por WhatsApp quando um lead chegar, na hora ou em um resumo nos horários que você escolher.</p></div><BellRing size={18} className="lead-muted" /></header>
      {data.recipients.length === 0 ? <p className="lead-muted">Ninguém recebe alertas ainda. Adicione a primeira pessoa abaixo.</p>
        : <ul className="lead-source-list">{data.recipients.map(item => <li key={item.id} className="lead-alert-item">
          <div className="lead-source-main">
            <strong>{item.name}
              {item.optedOutAt ? <span className="lead-badge is-off">Pediu para parar</span> : !item.active ? <span className="lead-badge is-off">Pausado</span> : <span className="lead-badge">Ativo</span>}</strong>
            <small>{formatPhone(item.phone)}</small>
            <small>{item.mode === "instant" ? <BellRing size={12} /> : <Clock size={12} />} {describeRule(item)}</small>
            <small>{item.campaignIds?.length ? `${item.campaignIds.length} campanha(s)` : "Todas as campanhas"} · {item.formIds?.length ? `${item.formIds.length} formulário(s)` : "todos os formulários"}</small>
            {item.deliveries.length > 0 && <ul className="lead-deliveries" aria-label={`Últimos envios para ${item.name}`}>{item.deliveries.map(delivery => <li key={delivery.id} data-status={delivery.status}>
              <span>{dateTime.format(new Date(delivery.createdAt))}</span><span>{KIND_LABEL[delivery.kind]}{delivery.kind === "digest" && delivery.status === "sent" ? ` (${delivery.leadCount})` : ""}</span><b>{STATUS_LABEL[delivery.status]}</b>{delivery.error && <em>{delivery.error}</em>}</li>)}</ul>}
          </div>
          <div className="lead-source-actions">
            <button type="button" className="lead-btn" disabled={pending || !!item.optedOutAt} onClick={() => run(() => sendAlertTestAction({ clientId, recipientId: item.id }), { busy: `test-${item.id}` })}><Send size={14} />{busy === `test-${item.id}` ? "Enviando…" : "Enviar teste"}</button>
            <button type="button" className="lead-btn" disabled={pending} onClick={() => edit(item)}>Editar</button>
            {!item.optedOutAt && <button type="button" className="lead-btn" disabled={pending} onClick={() => run(() => setAlertRecipientActiveAction({ clientId, recipientId: item.id, active: !item.active }))}>{item.active ? "Pausar" : "Reativar"}</button>}
            <button type="button" className="lead-btn" disabled={pending} onClick={() => { if (window.confirm(`Remover ${item.name}? Ela deixa de receber os alertas.`)) run(() => removeAlertRecipientAction({ clientId, recipientId: item.id })); }}>Remover</button>
          </div>
        </li>)}</ul>}
      {!draft && <button type="button" className="lead-btn is-primary lead-add" disabled={pending} onClick={() => { setNotice(""); setError(""); setDraft({ ...EMPTY_DRAFT }); }}><Plus size={14} />Adicionar pessoa</button>}
    </section>

    {draft && <section className="lead-panel" aria-labelledby="alert-form-title">
      <header><div><h2 id="alert-form-title">{draft.id ? "Editar pessoa" : "Nova pessoa"}</h2></div><button type="button" className="lead-more" onClick={() => setDraft(null)} aria-label="Fechar formulário"><X size={16} /></button></header>
      <form className="lead-form-inline lead-alert-form" onSubmit={event => { event.preventDefault(); save(); }}>
        <label>Nome<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required minLength={2} maxLength={80} placeholder="Ex.: Maria (atendimento)" disabled={pending} /></label>
        <label>WhatsApp<input value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })} required inputMode="tel" placeholder="(91) 98074-8371" disabled={pending} /></label>

        <fieldset><legend>Quando avisar</legend>
          <label className="lead-check"><input type="radio" name="mode" checked={draft.mode === "instant"} onChange={() => setDraft({ ...draft, mode: "instant" })} />Na hora: uma mensagem a cada lead novo</label>
          <label className="lead-check"><input type="radio" name="mode" checked={draft.mode === "scheduled"} onChange={() => setDraft({ ...draft, mode: "scheduled" })} />Em horários fixos: um resumo com os leads novos desde o último</label>
          {draft.mode === "scheduled" && <div className="lead-schedule">
            <div className="lead-times">{draft.times.map(time => <span key={time} className="lead-time-chip">{time}<button type="button" onClick={() => setDraft({ ...draft, times: draft.times.filter(item => item !== time) })} aria-label={`Remover ${time}`}><X size={12} /></button></span>)}
              {draft.times.length === 0 && <span className="lead-muted">Nenhum horário ainda.</span>}</div>
            <div className="lead-time-add"><input type="time" value={newTime} onChange={event => setNewTime(event.target.value)} aria-label="Novo horário" /><button type="button" className="lead-btn" onClick={addTime}><Plus size={14} />Adicionar horário</button></div>
            <div className="lead-days" role="group" aria-label="Dias da semana">{WEEKDAY_NAMES.map((label, day) => <button key={day} type="button" className={`lead-chip-status${draft.weekdays.includes(day) ? " is-on" : ""}`} aria-pressed={draft.weekdays.includes(day)}
              onClick={() => setDraft({ ...draft, weekdays: draft.weekdays.length === 1 && draft.weekdays.includes(day) ? draft.weekdays : toggle(draft.weekdays, day) })}>{label}</button>)}</div>
          </div>}
        </fieldset>

        <fieldset><legend>Campanhas <span className="lead-muted">(nenhuma marcada = todas)</span></legend>
          {campaigns.length === 0 ? <span className="lead-muted">As campanhas aparecem aqui quando chegarem leads com origem.</span>
            : campaigns.map(campaign => <label key={campaign.id} className="lead-check"><input type="checkbox" checked={draft.campaignIds.includes(campaign.id)} onChange={() => setDraft({ ...draft, campaignIds: toggle(draft.campaignIds, campaign.id) })} />{campaign.name} <span className="lead-muted">({campaign.count})</span></label>)}
        </fieldset>
        {forms.length > 0 && <fieldset><legend>Formulários <span className="lead-muted">(nenhum marcado = todos)</span></legend>
          {forms.map(form => <label key={form.id} className="lead-check"><input type="checkbox" checked={draft.formIds.includes(form.id)} onChange={() => setDraft({ ...draft, formIds: toggle(draft.formIds, form.id) })} />{form.name}</label>)}</fieldset>}

        <label className="lead-check lead-consent"><input type="checkbox" checked={draft.consent} onChange={event => setDraft({ ...draft, consent: event.target.checked })} />{draft.id ? "Se trocar o número, confirmo que a pessoa concordou em receber os alertas." : "Confirmo que esta pessoa concordou em receber os alertas de lead neste WhatsApp."}</label>
        <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setDraft(null)} disabled={pending}>Cancelar</button><button type="submit" className="lead-btn is-primary" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </section>}
  </div>;
}

