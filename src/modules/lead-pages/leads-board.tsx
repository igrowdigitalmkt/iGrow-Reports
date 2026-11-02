"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Download, Mail, MessageCircle, Search, Volume2, VolumeX } from "lucide-react";
import { Select } from "@/components/ui/select";
import { ago, formatPhone } from "./lead-feed-view";
import type { BoardApi } from "./leads-api";
import {
  EMPTY_FILTERS, LEAD_PERIODS, LEAD_STATUSES, PERIOD_LABEL, STATUS_LABEL, platformLabel,
  type BoardLead, type LeadEvent, type LeadFilters, type LeadStatus, type LeadsBoardData,
} from "./hub-types";
import "./lead-feed.css";

const POLL_MS = 5000;
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
const csvCell = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`;

type Props = { initial: LeadsBoardData; api: BoardApi; canUpdate: boolean };

/** Painel de leads: filtros, funil, lista ao vivo e histórico por lead. Igual no menu do cliente, no portal e no link compartilhado. */
export function LeadsBoard({ initial, api, canUpdate: canUpdateInitial }: Props) {
  const [board, setBoard] = useState(initial);
  const [canUpdate, setCanUpdate] = useState(canUpdateInitial);
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(() => new Date(initial.serverTime));
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [sound, setSound] = useState(false);
  const [now, setNow] = useState(() => new Date(initial.serverTime).getTime());
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState("");
  const known = useRef(new Set(initial.leads.map(lead => lead.id)));
  const filtersRef = useRef(filters);
  const soundOn = useRef(false);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { soundOn.current = sound; }, [sound]);

  const beep = useCallback(() => {
    try {
      const context = new AudioContext();
      const tone = context.createOscillator(); const gain = context.createGain();
      tone.type = "sine"; tone.frequency.value = 880; gain.gain.setValueAtTime(.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.18, context.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .45);
      tone.connect(gain).connect(context.destination); tone.start(); tone.stop(context.currentTime + .5);
      tone.onended = () => void context.close();
    } catch { /* sem áudio neste navegador: o destaque visual continua */ }
  }, []);

  const load = useCallback(async (wanted: LeadFilters, silent = true) => {
    try {
      const next = await api.load(wanted);
      if (wanted !== filtersRef.current) return;
      const arrived = next.leads.filter(lead => !known.current.has(lead.id)).map(lead => lead.id);
      arrived.forEach(id => known.current.add(id));
      if (arrived.length && silent) {
        setFresh(current => new Set([...current, ...arrived]));
        setTimeout(() => setFresh(current => { const rest = new Set(current); arrived.forEach(id => rest.delete(id)); return rest; }), 9000);
        if (soundOn.current) beep();
      }
      setBoard(next); setUpdatedAt(new Date(next.serverTime)); setOnline(true);
      if (typeof next.canUpdate === "boolean") setCanUpdate(next.canUpdate);
    } catch { setOnline(false); }
  }, [api, beep]);

  // Atualização ao vivo e ao trocar de aba do navegador.
  useEffect(() => {
    const tick = () => { if (!document.hidden) void load(filtersRef.current); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [load]);
  useEffect(() => { const tick = () => setNow(Date.now()); const first = setTimeout(tick, 0); const timer = setInterval(tick, 30_000); return () => { clearTimeout(first); clearInterval(timer); }; }, []);
  // Busca com pequeno atraso para não consultar a cada letra.
  useEffect(() => {
    const timer = setTimeout(() => setFilters(current => current.q === search ? current : { ...current, q: search }), 300);
    return () => clearTimeout(timer);
  }, [search]);
  // Filtros mudaram: recarrega na hora (a lista antiga continua visível até chegar a nova).
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } void load(filters, false); }, [filters, load]);

  const toggleStatus = (status: LeadStatus) => setFilters(current => ({ ...current, status: current.status.includes(status) ? current.status.filter(item => item !== status) : [...current.status, status] }));
  const copy = async (value: string, key: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(current => current === key ? null : current), 1600); } catch { /* sem permissão da área de transferência */ }
  };
  const changeStatus = async (lead: BoardLead, status: LeadStatus) => {
    setError("");
    const previous = board;
    setBoard(current => ({ ...current, leads: current.leads.map(item => item.id === lead.id ? { ...item, status, statusChangedAt: new Date().toISOString() } : item),
      statusCounts: { ...current.statusCounts, [lead.status]: Math.max(0, current.statusCounts[lead.status] - 1), [status]: current.statusCounts[status] + 1 } }));
    if (!await api.setStatus(lead.id, status)) { setBoard(previous); setError("Não foi possível salvar o status. Tente de novo."); }
    else void load(filtersRef.current);
  };
  const exportCsv = () => {
    const rows = [["Data", "Nome", "WhatsApp", "E-mail", "Status", "Formulário", "Campanha", "Conjunto", "Anúncio", "Plataforma", "Respostas"], ...board.leads.map(lead => [dateTime.format(new Date(lead.createdTime)), lead.name, lead.phone, lead.email, STATUS_LABEL[lead.status], lead.formName, lead.campaignName, lead.adsetName, lead.adName, platformLabel(lead.platform), lead.answers.map(item => `${item.question} ${item.answer}`).join(" | ")])];
    const csv = "﻿" + rows.map(row => row.map(cell => csvCell(cell)).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const filtered = filters.forms.length > 0 || filters.campaigns.length > 0 || filters.status.length > 0 || filters.q.trim() !== "" || filters.period !== "all";
  const selectedForm = filters.forms[0] ?? "";

  return <section className="leads-board" aria-label="Leads">
    <div className="lead-hero">
      <div><p>Cadastros que chegam dos anúncios, em tempo real. Atualizado às {clock.format(updatedAt)}.</p></div>
      <div className="lead-tools">
        <span className={`lead-live${online ? "" : " is-offline"}`} role="status" aria-live="polite"><i aria-hidden="true" />{online ? "Ao vivo" : "Reconectando…"}</span>
        <button type="button" className="lead-btn" onClick={() => setSound(value => !value)} aria-pressed={sound} title="Toca um aviso quando um cadastro chega (mantenha esta página aberta)">{sound ? <Volume2 size={15} /> : <VolumeX size={15} />}Aviso sonoro {sound ? "ligado" : "desligado"}</button>
        <button type="button" className="lead-btn" onClick={exportCsv} disabled={!board.leads.length}><Download size={15} />Baixar planilha</button>
      </div>
    </div>

    <div className="lead-kpis" role="group" aria-label="Resumo">
      <div><span>Hoje</span><strong>{board.today}</strong></div>
      <div><span>Total de leads</span><strong>{board.total}</strong></div>
      <div><span>Em atendimento</span><strong>{board.statusCounts.contacted + board.statusCounts.visit}</strong></div>
      <div><span>Fechados</span><strong>{board.statusCounts.won}</strong></div>
    </div>

    <div className="lead-filters">
      <label className="lead-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, WhatsApp ou e-mail" aria-label="Buscar leads" /></label>
      <Select className="compact-select lead-filter-select" inline aria-label="Formulário" value={selectedForm} onChange={event => setFilters(current => ({ ...current, forms: event.target.value ? [event.target.value] : [] }))}>
        <option value="">Todos os formulários</option>
        {board.forms.map(form => <option key={form.id} value={form.id}>{form.name} ({form.count})</option>)}
      </Select>
      {board.campaigns.length > 0 && <Select className="compact-select lead-filter-select" inline aria-label="Campanha" value={filters.campaigns[0] ?? ""} onChange={event => setFilters(current => ({ ...current, campaigns: event.target.value ? [event.target.value] : [] }))}>
        <option value="">Todas as campanhas</option>
        {board.campaigns.map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.name} ({campaign.count})</option>)}
      </Select>}
      <Select className="compact-select lead-filter-select" inline aria-label="Período" value={filters.period} onChange={event => setFilters(current => ({ ...current, period: event.target.value as LeadFilters["period"] }))}>
        {LEAD_PERIODS.map(period => <option key={period} value={period}>{PERIOD_LABEL[period]}</option>)}
      </Select>
    </div>
    <div className="lead-chips" role="group" aria-label="Filtrar por status">
      {LEAD_STATUSES.map(status => <button key={status} type="button" className={`lead-chip-status${filters.status.includes(status) ? " is-on" : ""}`} data-status={status} aria-pressed={filters.status.includes(status)} onClick={() => toggleStatus(status)}>{STATUS_LABEL[status]}<b>{board.statusCounts[status]}</b></button>)}
      {filtered && <button type="button" className="lead-clear" onClick={() => { setFilters(EMPTY_FILTERS); setSearch(""); }}>Limpar filtros</button>}
    </div>
    {error && <p role="alert" className="lead-error">{error}</p>}

    {board.leads.length ? <div className="lead-table-list"><div className="lead-list-head" aria-hidden="true"><span>Quando</span><span>Nome</span><span>Contato</span><span>Origem</span><span>Status</span></div><ol className="lead-list" aria-label="Leads, do mais recente para o mais antigo">{board.leads.map(lead => <LeadRowItem key={lead.id} lead={lead} now={now} fresh={fresh.has(lead.id)} canUpdate={canUpdate} api={api}
      open={open === lead.id} onToggle={() => setOpen(current => current === lead.id ? null : lead.id)} onStatus={status => void changeStatus(lead, status)} copied={copied} onCopy={copy} />)}</ol></div>
      : filtered ? <div className="lead-empty"><strong>Nenhum lead com esses filtros</strong><p>Ajuste a busca ou limpe os filtros para ver todos.</p></div>
      : <div className="lead-empty"><i aria-hidden="true" /><strong>Aguardando o primeiro lead</strong><p>Assim que alguém preencher o formulário do anúncio, ele aparece aqui sozinho. Não precisa atualizar a página.</p></div>}
    {board.matching > board.leads.length && <p className="lead-foot">Mostrando os {board.leads.length} mais recentes de {board.matching}. Use os filtros para refinar.</p>}
  </section>;
}

const STATUS_COLOR: Record<LeadStatus, string> = { new: "var(--accent)", contacted: "var(--warn)", visit: "var(--violet)", won: "var(--good)", lost: "var(--muted)" };
const originOf = (lead: BoardLead) => [lead.campaignName, lead.adsetName, lead.adName].filter(Boolean).join(" › ");

function LeadRowItem({ lead, now, fresh, canUpdate, api, open, onToggle, onStatus, copied, onCopy }: {
  lead: BoardLead; now: number; fresh: boolean; canUpdate: boolean; api: BoardApi; open: boolean; onToggle: () => void; onStatus: (status: LeadStatus) => void;
  copied: string | null; onCopy: (value: string, key: string) => void;
}) {
  const origin = originOf(lead) || lead.formName;
  const platform = platformLabel(lead.platform);
  return <li className={`lead-row has-status is-compact${fresh ? " is-new" : ""}${open ? " is-open" : ""}`}>
    <time className="lead-when" dateTime={lead.createdTime} title={dateTime.format(new Date(lead.createdTime))}><strong>{ago(now - new Date(lead.createdTime).getTime())}</strong></time>
    <div className="lead-name"><span className="lead-name-text" title={lead.name ?? undefined}>{lead.name ?? <span className="lead-muted">Sem nome</span>}</span>{fresh && <span className="lead-badge">Novo</span>}</div>
    <div className="lead-contact">
      {lead.phone ? <span className="lead-chip"><a href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer" aria-label={`Chamar ${lead.name ?? "contato"} no WhatsApp`}><MessageCircle size={14} />{formatPhone(lead.phone)}</a>
        <button type="button" onClick={() => onCopy(lead.phone!, `p${lead.id}`)} aria-label="Copiar WhatsApp">{copied === `p${lead.id}` ? <Check size={13} /> : <Copy size={13} />}</button></span> : <span className="lead-muted">Sem WhatsApp</span>}
      {lead.email && <span className="lead-chip is-email"><a href={`mailto:${lead.email}`} title={lead.email}><Mail size={14} /><span>{lead.email}</span></a>
        <button type="button" onClick={() => onCopy(lead.email!, `e${lead.id}`)} aria-label="Copiar e-mail">{copied === `e${lead.id}` ? <Check size={13} /> : <Copy size={13} />}</button></span>}
    </div>
    <div className="lead-origin-cell" title={origin}>{platform && <b>{platform}</b>}<span>{origin}</span></div>
    <div className="lead-status">
      {canUpdate
        ? <Select className={`lead-status-trigger is-${lead.status}`} inline dots={STATUS_COLOR} value={lead.status} onChange={event => onStatus(event.target.value as LeadStatus)} aria-label={`Status de ${lead.name ?? "lead"}`}>{LEAD_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}</Select>
        : <span className="lead-status-badge" data-status={lead.status}>{STATUS_LABEL[lead.status]}</span>}
      <button type="button" className="lead-more" onClick={onToggle} aria-expanded={open} aria-label={open ? "Fechar detalhes" : "Abrir detalhes"} title="Detalhes, notas e histórico"><ChevronDown size={16} /></button>
    </div>
    {open && <LeadDetail lead={lead} api={api} canUpdate={canUpdate} />}
  </li>;
}

function LeadDetail({ lead, api, canUpdate }: { lead: BoardLead; api: BoardApi; canUpdate: boolean }) {
  const leadId = lead.id;
  const [events, setEvents] = useState<LeadEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const reload = useCallback(async () => { try { setEvents(await api.events(leadId)); setFailed(false); } catch { setFailed(true); } }, [api, leadId]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);
  const save = async () => {
    if (!note.trim() || saving) return;
    setSaving(true);
    const ok = await api.addNote(leadId, note.trim());
    setSaving(false);
    if (ok) { setNote(""); void reload(); } else setFailed(true);
  };
  const facts: [string, string][] = [["Formulário", lead.formName], ["Campanha", lead.campaignName ?? ""], ["Conjunto", lead.adsetName ?? ""], ["Anúncio", lead.adName ?? ""], ["Plataforma", platformLabel(lead.platform) ?? ""], ["Recebido em", dateTime.format(new Date(lead.createdTime))]];
  return <div className="lead-detail">
    <div className="lead-detail-main">
      <dl className="lead-facts">
        {facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {lead.answers.map(item => <div key={item.question} className="is-answer"><dt>{item.question}</dt><dd>{item.answer}</dd></div>)}
      </dl>
      {canUpdate && <form className="lead-note-form" onSubmit={event => { event.preventDefault(); void save(); }}>
        <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={2} placeholder="Escreva uma nota (quem atendeu, o que ficou combinado…)" aria-label="Nova nota" />
        <button type="submit" className="lead-btn is-primary" disabled={!note.trim() || saving}>{saving ? "Salvando…" : "Salvar nota"}</button>
      </form>}
    </div>
    <aside className="lead-history" aria-label="Histórico do lead">
      <h4>Histórico</h4>
      {failed && <p role="alert" className="lead-error">Não foi possível carregar ou salvar o histórico.</p>}
      {events === null ? <p className="lead-muted">Carregando histórico…</p> : events.length === 0 ? <p className="lead-muted">Ainda não há notas nem mudanças de status.</p>
        : <ul className="lead-timeline">{events.map(event => <li key={event.id}>
          <span className="lead-timeline-dot" data-status={event.status ?? "note"} aria-hidden="true" />
          <div><strong>{event.kind === "status" && event.status ? STATUS_LABEL[event.status] : "Nota"}</strong><small>{event.actor} · {dateTime.format(new Date(event.createdAt))}</small>{event.body && <p>{event.body}</p>}</div></li>)}</ul>}
    </aside>
  </div>;
}
