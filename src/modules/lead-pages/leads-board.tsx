"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AtSign, Check, ChevronDown, Copy, Download, Mail, MessageCircle, Search, Trash2, Volume2, VolumeX } from "lucide-react";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { ago, formatPhone } from "./lead-feed-view";
import type { BoardApi } from "./leads-api";
import {
  CHANNEL_LABEL, EMPTY_FILTERS, LEAD_PERIODS, LEAD_STATUSES, PERIOD_LABEL, STATUS_LABEL, platformLabel,
  type BoardLead, type LeadEvent, type LeadFilters, type LeadStatus, type LeadsBoardData,
} from "./hub-types";
import "./lead-feed.css";

const POLL_MS = 5000;
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
const csvCell = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`;

type Props = { initial: LeadsBoardData; api: BoardApi; canUpdate: boolean; /** Só no painel de quem administra: devolve a mensagem de erro, ou null quando excluiu. */ onDeleteLead?: (leadId: string) => Promise<string | null>; /** Exclusão em lote (até 200): devolve a mensagem de erro, ou null quando excluiu. */ onDeleteLeads?: (leadIds: string[]) => Promise<string | null> };

/** Painel de leads: filtros, funil, lista ao vivo e histórico por lead. Igual no menu do cliente, no portal e no link compartilhado. */
export function LeadsBoard({ initial, api, canUpdate: canUpdateInitial, onDeleteLead, onDeleteLeads }: Props) {
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkWord, setBulkWord] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
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

  // Só o que ainda está na lista continua selecionado (a lista se atualiza sozinha).
  const visibleIds = board.leads.map(item => item.id);
  const chosen = visibleIds.filter(id => selected.has(id));
  const allChosen = visibleIds.length > 0 && chosen.length === visibleIds.length;
  const needsWord = chosen.length >= 10;
  const toggleOne = (id: string, on: boolean) => setSelected(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  const removeChosen = async () => {
    if (!onDeleteLeads || !chosen.length) return;
    setBulkBusy(true); setError("");
    const failure = await onDeleteLeads(chosen).catch(() => "Não foi possível excluir agora. Nada foi apagado.");
    setBulkBusy(false);
    if (failure) { setError(failure); setBulkOpen(false); return; }
    const gone = new Set(chosen);
    setBoard(current => {
      const counts = { ...current.statusCounts };
      for (const item of current.leads) if (gone.has(item.id)) counts[item.status] = Math.max(0, counts[item.status] - 1);
      return { ...current, leads: current.leads.filter(item => !gone.has(item.id)), total: Math.max(0, current.total - gone.size), matching: Math.max(0, current.matching - gone.size), statusCounts: counts };
    });
    setSelected(new Set()); setBulkOpen(false); setBulkWord(""); setOpen(null);
    void load(filtersRef.current);
  };
  const removeLead = async (lead: BoardLead): Promise<boolean> => {
    if (!onDeleteLead) return false;
    setError("");
    const failure = await onDeleteLead(lead.id).catch(() => "Não foi possível excluir agora. Nada foi apagado.");
    if (failure) { setError(failure); return false; }
    setOpen(null);
    setBoard(current => ({ ...current, leads: current.leads.filter(item => item.id !== lead.id), total: Math.max(0, current.total - 1), matching: Math.max(0, current.matching - 1),
      statusCounts: { ...current.statusCounts, [lead.status]: Math.max(0, current.statusCounts[lead.status] - 1) } }));
    void load(filtersRef.current);
    return true;
  };
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
    const rows = [["Data", "Nome", "WhatsApp", "E-mail", "Status", "Fonte", "Campanha", "Conjunto", "Anúncio", "Plataforma", "Respostas"], ...board.leads.map(lead => [dateTime.format(new Date(lead.createdTime)), lead.name, lead.phone, lead.email, STATUS_LABEL[lead.status], lead.formName, lead.campaignName, lead.adsetName, lead.adName, platformLabel(lead.platform), lead.answers.map(item => `${item.question} ${item.answer}`).join(" | ")])];
    const csv = "﻿" + rows.map(row => row.map(cell => csvCell(cell)).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const filtered = filters.channel !== "" || filters.forms.length > 0 || filters.campaigns.length > 0 || filters.status.length > 0 || filters.q.trim() !== "" || filters.period !== "all";
  const selectedForm = filters.forms[0] ?? "";

  return <section className="leads-board" aria-label="Leads">
    <div className="lead-hero">
      <div><p>Contatos que chegam em tempo real. Atualizado às {clock.format(updatedAt)}.</p></div>
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

    {(board.channels.length > 1 || filters.channel) && <div className="lead-chips lead-channels" role="group" aria-label="Filtrar por canal">
      <button type="button" className={`lead-chip-status${filters.channel === "" ? " is-on" : ""}`} aria-pressed={filters.channel === ""} onClick={() => setFilters(current => ({ ...current, channel: "" }))}>Todos<b>{board.channels.reduce((sum, item) => sum + item.count, 0)}</b></button>
      {board.channels.map(item => <button key={item.channel} type="button" className={`lead-chip-status${filters.channel === item.channel ? " is-on" : ""}`} aria-pressed={filters.channel === item.channel} onClick={() => setFilters(current => ({ ...current, channel: item.channel }))}>{CHANNEL_LABEL[item.channel]}<b>{item.count}</b></button>)}
    </div>}
    <div className="lead-filters">
      <label className="lead-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, WhatsApp ou e-mail" aria-label="Buscar leads" /></label>
      <Select className="compact-select lead-filter-select" inline aria-label="Fonte" value={selectedForm} onChange={event => setFilters(current => ({ ...current, forms: event.target.value ? [event.target.value] : [] }))}>
        <option value="">Todas as fontes</option>
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

    {onDeleteLeads && board.leads.length > 0 && <div className="lead-bulk" role="group" aria-label="Seleção de leads">
      <label className="lead-bulk-all"><input type="checkbox" checked={allChosen} onChange={event => setSelected(event.target.checked ? new Set(visibleIds) : new Set())} />{chosen.length ? `${chosen.length} selecionado(s)` : "Selecionar todos"}</label>
      {chosen.length > 0 && <><button type="button" className="lead-btn is-danger" onClick={() => { setBulkWord(""); setBulkOpen(true); }}><Trash2 size={14} aria-hidden="true" />Excluir {chosen.length === 1 ? "1 lead" : `${chosen.length} leads`}</button>
        <button type="button" className="lead-link-btn" onClick={() => setSelected(new Set())}>Limpar seleção</button></>}
    </div>}
    {onDeleteLeads && <Dialog open={bulkOpen} onOpenChange={open => { if (!bulkBusy) setBulkOpen(open); }} title={chosen.length === 1 ? "Excluir 1 lead?" : `Excluir ${chosen.length} leads?`} description="Esta ação não pode ser desfeita.">
      <form className="lead-delete-dialog" onSubmit={event => { event.preventDefault(); if (!needsWord || bulkWord.trim().toUpperCase() === "EXCLUIR") void removeChosen(); }}>
        <p>Os leads escolhidos, com as notas e o histórico, serão <strong>excluídos para sempre</strong>. Leads de formulário não serão importados de novo da Meta.</p>
        {needsWord && <label>Para confirmar, digite <strong>EXCLUIR</strong><input value={bulkWord} onChange={event => setBulkWord(event.target.value)} autoComplete="off" placeholder="EXCLUIR" aria-label="Digite EXCLUIR para confirmar" disabled={bulkBusy} /></label>}
        <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>Cancelar</button>
          <button type="submit" className="lead-btn is-danger" disabled={bulkBusy || !chosen.length || (needsWord && bulkWord.trim().toUpperCase() !== "EXCLUIR")}>{bulkBusy ? "Excluindo…" : "Excluir leads"}</button></div>
      </form>
    </Dialog>}
    {board.leads.length ? <div className="lead-table-list"><div className="lead-list-head" aria-hidden="true"><span>Quando</span><span>Nome</span><span>Contato</span><span>Origem</span><span>Status</span></div><ol className="lead-list" aria-label="Leads, do mais recente para o mais antigo">{board.leads.map(lead => <LeadRowItem key={lead.id} lead={lead} now={now} fresh={fresh.has(lead.id)} canUpdate={canUpdate} api={api}
      open={open === lead.id} onToggle={() => setOpen(current => current === lead.id ? null : lead.id)} onStatus={status => void changeStatus(lead, status)} onDelete={onDeleteLead ? () => removeLead(lead) : undefined} selectable={!!onDeleteLeads} selected={selected.has(lead.id)} onSelect={on => toggleOne(lead.id, on)} copied={copied} onCopy={copy} />)}</ol></div>
      : filtered ? <div className="lead-empty"><strong>Nenhum lead com esses filtros</strong><p>Ajuste a busca ou limpe os filtros para ver todos.</p></div>
      : <div className="lead-empty"><i aria-hidden="true" /><strong>Aguardando o primeiro lead</strong><p>Assim que um novo contato chegar pelos seus anúncios, ele aparece aqui sozinho. Não precisa atualizar a página.</p></div>}
    {board.matching > board.leads.length && <p className="lead-foot">Mostrando os {board.leads.length} mais recentes de {board.matching}. Use os filtros para refinar.</p>}
  </section>;
}

const STATUS_COLOR: Record<LeadStatus, string> = { new: "var(--accent)", contacted: "var(--warn)", visit: "var(--violet)", won: "var(--good)", lost: "var(--muted)" };
const originOf = (lead: BoardLead) => [lead.campaignName, lead.adsetName, lead.adName].filter(Boolean).join(" › ");

function LeadRowItem({ lead, now, fresh, canUpdate, api, open, onToggle, onStatus, onDelete, selectable, selected, onSelect, copied, onCopy }: {
  onDelete?: () => Promise<boolean>; selectable?: boolean; selected?: boolean; onSelect?: (on: boolean) => void;
  lead: BoardLead; now: number; fresh: boolean; canUpdate: boolean; api: BoardApi; open: boolean; onToggle: () => void; onStatus: (status: LeadStatus) => void;
  copied: string | null; onCopy: (value: string, key: string) => void;
}) {
  const isMessage = lead.channel !== "form";
  const origin = originOf(lead) || (isMessage ? "" : lead.formName);
  const platform = lead.channel === "whatsapp" ? "WhatsApp" : lead.channel === "instagram" ? "Instagram" : platformLabel(lead.platform);
  return <li className={`lead-row has-status is-compact${fresh ? " is-new" : ""}${open ? " is-open" : ""}`}>
    <div className="lead-when-wrap">{selectable && <input type="checkbox" className="lead-select-box" checked={!!selected} onChange={event => onSelect?.(event.target.checked)} aria-label={`Selecionar ${lead.name ?? lead.handle ?? "lead"}`} />}
      <time className="lead-when" dateTime={lead.createdTime} title={dateTime.format(new Date(lead.createdTime))}><strong>{ago(now - new Date(lead.createdTime).getTime())}</strong></time></div>
    <div className="lead-name"><span className="lead-name-text" title={lead.name ?? undefined}>{lead.name ?? <span className="lead-muted">Sem nome</span>}</span>{fresh && <span className="lead-badge">Novo</span>}</div>
    <div className="lead-contact">
      {!lead.phone && lead.handle ? <span className="lead-chip"><a href={`https://instagram.com/${lead.handle}`} target="_blank" rel="noreferrer" aria-label={`Abrir o perfil de ${lead.handle} no Instagram`}><AtSign size={14} />{lead.handle}</a>
        <button type="button" onClick={() => onCopy(`@${lead.handle!}`, `h${lead.id}`)} aria-label="Copiar usuário">{copied === `h${lead.id}` ? <Check size={13} /> : <Copy size={13} />}</button></span> : lead.phone ? <span className="lead-chip"><a href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer" aria-label={`Chamar ${lead.name ?? "contato"} no WhatsApp`}><MessageCircle size={14} />{formatPhone(lead.phone)}</a>
        <button type="button" onClick={() => onCopy(lead.phone!, `p${lead.id}`)} aria-label="Copiar WhatsApp">{copied === `p${lead.id}` ? <Check size={13} /> : <Copy size={13} />}</button></span> : <span className="lead-muted">Sem WhatsApp</span>}
      {lead.email && <span className="lead-chip is-email"><a href={`mailto:${lead.email}`} title={lead.email}><Mail size={14} /><span>{lead.email}</span></a>
        <button type="button" onClick={() => onCopy(lead.email!, `e${lead.id}`)} aria-label="Copiar e-mail">{copied === `e${lead.id}` ? <Check size={13} /> : <Copy size={13} />}</button></span>}
    </div>
    <div className="lead-origin-cell" title={origin || "Origem não confirmada"}>{platform && <b>{platform}</b>}<span>{origin}</span></div>
    <div className="lead-status">
      {canUpdate
        ? <Select className={`lead-status-trigger is-${lead.status}`} inline dots={STATUS_COLOR} value={lead.status} onChange={event => onStatus(event.target.value as LeadStatus)} aria-label={`Status de ${lead.name ?? "lead"}`}>{LEAD_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}</Select>
        : <span className="lead-status-badge" data-status={lead.status}>{STATUS_LABEL[lead.status]}</span>}
      <button type="button" className="lead-more" onClick={onToggle} aria-expanded={open} aria-label={open ? "Fechar detalhes" : "Abrir detalhes"} title="Detalhes, notas e histórico"><ChevronDown size={16} /></button>
    </div>
    {open && <LeadDetail lead={lead} api={api} canUpdate={canUpdate} onDelete={onDelete} />}
  </li>;
}

function LeadDetail({ lead, api, canUpdate, onDelete }: { lead: BoardLead; api: BoardApi; canUpdate: boolean; onDelete?: () => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
  const facts: [string, string][] = [[lead.channel !== "form" ? "Canal" : "Fonte", lead.formName], ["Campanha", lead.campaignName ?? ""], ["Conjunto", lead.adsetName ?? ""], ["Anúncio", lead.adName ?? ""], ["Plataforma", platformLabel(lead.platform) ?? ""], ["Recebido em", dateTime.format(new Date(lead.createdTime))]];
  return <div className="lead-detail">
    <div className="lead-detail-main">
      <dl className="lead-facts">
        {facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {lead.firstMessage && <div className="is-answer"><dt>Primeira mensagem</dt><dd>{lead.firstMessage}</dd></div>}
        {lead.answers.map(item => <div key={item.question} className="is-answer"><dt>{item.question}</dt><dd>{item.answer}</dd></div>)}
      </dl>
      <div className="lead-detail-actions">
      {lead.channel === "instagram" && lead.handle && <a className="lead-btn" href={`https://ig.me/m/${lead.handle}`} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden="true" />Abrir conversa</a>}
      {lead.channel === "whatsapp" && lead.phone && <a className="lead-btn" href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer"><MessageCircle size={14} aria-hidden="true" />Abrir conversa</a>}
      {onDelete && <button type="button" className="lead-btn is-danger" onClick={() => setConfirming(true)}><Trash2 size={14} aria-hidden="true" />Excluir lead</button>}
      </div>
      {onDelete && <Dialog open={confirming} onOpenChange={open => { if (!deleting) setConfirming(open); }} title="Excluir este lead?" description={lead.name ?? lead.handle ?? lead.phone ?? "Lead sem nome"}>
        <div className="lead-delete-dialog">
          <p>O lead, as notas e o histórico dele serão <strong>excluídos para sempre</strong>. Isso não pode ser desfeito.</p>
          <p className="lead-muted">{lead.channel === "form" ? "Ele não será importado de novo da Meta. " : "A conversa no próprio aplicativo não é afetada; se a pessoa mandar uma nova mensagem, nasce um novo lead. "}Quem só vê pelo link não tem acesso a esta opção.</p>
          <div className="lead-form-actions"><button type="button" className="lead-btn" onClick={() => setConfirming(false)} disabled={deleting}>Cancelar</button>
            <button type="button" className="lead-btn is-danger" disabled={deleting} onClick={async () => { setDeleting(true); const ok = await onDelete(); setDeleting(false); if (!ok) setConfirming(false); }}>{deleting ? "Excluindo…" : "Excluir lead"}</button></div>
        </div>
      </Dialog>}
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
