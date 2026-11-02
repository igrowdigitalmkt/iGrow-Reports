"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Mail, MessageCircle, Volume2, VolumeX } from "lucide-react";
import { Brand } from "@/components/layout/brand";
import { formatPhone } from "./hub-types";
import type { LeadFeed, LeadItem } from "./store";
import "./lead-feed.css";

const POLL_MS = 5000;
const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "agora", "há 3 min", "há 2 h", "há 4 d" a partir da diferença em milissegundos. */
export function ago(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 1440) return `há ${Math.floor(minutes / 60)} h`;
  return `há ${Math.floor(minutes / 1440)} d`;
}

export { formatPhone };
const whatsappLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
const csvCell = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`;

export function LeadFeedView({ slug, code, initial }: { slug: string; code: string; initial: LeadFeed }) {
  const [feed, setFeed] = useState(initial);
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(() => new Date(initial.serverTime));
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [sound, setSound] = useState(false);
  // Começa na hora do servidor (igual no HTML e no navegador) e passa para o relógio real logo após a montagem.
  const [now, setNow] = useState(() => new Date(initial.serverTime).getTime());
  const [copied, setCopied] = useState<string | null>(null);
  const known = useRef(new Set(initial.leads.map(lead => lead.id)));
  const soundOn = useRef(false);
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

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/lead-pages/${slug}/feed`, { headers: { "x-lead-code": code }, cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = await response.json() as LeadFeed;
        if (!live) return;
        const arrived = next.leads.filter(lead => !known.current.has(lead.id)).map(lead => lead.id);
        arrived.forEach(id => known.current.add(id));
        if (arrived.length) {
          setFresh(current => new Set([...current, ...arrived]));
          setTimeout(() => setFresh(current => { const rest = new Set(current); arrived.forEach(id => rest.delete(id)); return rest; }), 9000);
          if (soundOn.current) beep();
        }
        setFeed(next); setUpdatedAt(new Date(next.serverTime)); setOnline(true);
      } catch { if (live) setOnline(false); }
    };
    const timer = setInterval(() => void load(), POLL_MS);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [slug, code, beep]);

  useEffect(() => { const tick = () => setNow(Date.now()); const first = setTimeout(tick, 0); const timer = setInterval(tick, 30_000); return () => { clearTimeout(first); clearInterval(timer); }; }, []);

  const copy = async (value: string, key: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(current => current === key ? null : current), 1600); } catch { /* sem permissão da área de transferência */ }
  };
  const exportCsv = () => {
    const rows = [["Data", "Nome", "WhatsApp", "E-mail", "Respostas"], ...feed.leads.map(lead => [dateTime.format(new Date(lead.createdTime)), lead.name, lead.phone, lead.email, lead.answers.map(item => `${item.question} ${item.answer}`).join(" | ")])];
    const csv = "﻿" + rows.map(row => row.map(cell => csvCell(cell)).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `cadastros-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };

  const row = (lead: LeadItem) => <li key={lead.id} className={`lead-row${fresh.has(lead.id) ? " is-new" : ""}`}>
    <div className="lead-when"><strong>{ago(now - new Date(lead.createdTime).getTime())}</strong><small>{dateTime.format(new Date(lead.createdTime))}</small></div>
    <div className="lead-name"><span>{lead.name ?? <span className="lead-muted">Sem nome</span>}{fresh.has(lead.id) && <span className="lead-badge">Novo</span>}</span>
      {lead.answers.length > 0 && <ul className="lead-answers">{lead.answers.map(item => <li key={item.question}><small>{item.question}</small><span>{item.answer}</span></li>)}</ul>}</div>
    <div className="lead-contact">
      {lead.phone ? <span className="lead-chip"><a href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer" aria-label={`Chamar ${lead.name ?? "contato"} no WhatsApp`}><MessageCircle size={14} />{formatPhone(lead.phone)}</a>
        <button type="button" onClick={() => void copy(lead.phone!, `p${lead.id}`)} aria-label="Copiar WhatsApp">{copied === `p${lead.id}` ? <Check size={13} /> : <Copy size={13} />}</button></span> : <span className="lead-muted">Sem WhatsApp</span>}
      {lead.email ? <span className="lead-chip"><a href={`mailto:${lead.email}`}><Mail size={14} />{lead.email}</a>
        <button type="button" onClick={() => void copy(lead.email!, `e${lead.id}`)} aria-label="Copiar e-mail">{copied === `e${lead.id}` ? <Check size={13} /> : <Copy size={13} />}</button></span> : null}
    </div>
  </li>;

  return <main className="lead-page">
    <header className="lead-header">
      <Brand />
      <span className={`lead-live${online ? "" : " is-offline"}`} role="status" aria-live="polite"><i aria-hidden="true" />{online ? "Ao vivo" : "Reconectando…"}</span>
    </header>
    <section className="lead-hero">
      <div><h1>{feed.title}</h1><p>Cadastros que chegam do anúncio, em tempo real. Atualizado às {clock.format(updatedAt)}.</p></div>
      <div className="lead-tools">
        <button type="button" className="lead-btn" onClick={() => setSound(value => !value)} aria-pressed={sound} title="Toca um aviso quando um cadastro chega (mantenha esta página aberta)">{sound ? <Volume2 size={15} /> : <VolumeX size={15} />}Aviso sonoro {sound ? "ligado" : "desligado"}</button>
        <button type="button" className="lead-btn" onClick={exportCsv} disabled={!feed.leads.length}><Download size={15} />Baixar planilha</button>
      </div>
    </section>
    <section className="lead-kpis" aria-label="Resumo">
      <div><span>Hoje</span><strong>{feed.today}</strong></div>
      <div><span>Total de cadastros</span><strong>{feed.total}</strong></div>
    </section>
    {feed.leads.length ? <ol className="lead-list" aria-label="Cadastros recebidos, do mais recente para o mais antigo">{feed.leads.map(row)}</ol>
      : <div className="lead-empty"><i aria-hidden="true" /><strong>Aguardando o primeiro cadastro</strong><p>Assim que um novo contato chegar pelos seus anúncios, ele aparece aqui sozinho. Não precisa atualizar a página.</p></div>}
    {feed.total > feed.leads.length && <p className="lead-foot">Mostrando os {feed.leads.length} cadastros mais recentes de {feed.total}.</p>}
    <footer className="lead-foot">Página privada. Não compartilhe este endereço: ele dá acesso aos contatos recebidos.</footer>
  </main>;
}
