"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock3, Contact, FileText, Image as ImageIcon, Lock, MapPin, MessageSquareText, Mic, MoreVertical, Play, Plus, QrCode, Search, Smile, Star, Sticker, UsersRound, Video } from "lucide-react";
import { clockTime, colorFor, conversationTitle, dayKey, dayLabel, formatWhatsAppPhone, initialsOf, kindLabel, listTime } from "./inbox-format";
import type { InboxChannel, InboxConversation, InboxList, InboxMessageItem, InboxStatus } from "./inbox-types";
import "./inbox.css";

type Filter = "all" | "unread" | "favorites" | "groups";
const QR_CHANNEL: InboxChannel = { key: "qr", kind: "qr", name: "Seu WhatsApp", phone: null, coexistence: false };

/**
 * WhatsApp inbox in the layout of WhatsApp Desktop: numbers on the left rail, conversations,
 * and the open chat. Read-only in this stage; replying from the iGrow comes next.
 */
export function WhatsAppInbox({ channels, demo = false, demoConversations = [], demoThreads = {} }: {
  channels: InboxChannel[]; demo?: boolean; demoConversations?: InboxConversation[]; demoThreads?: Record<string, InboxMessageItem[]>;
}) {
  const [qrPhone, setQrPhone] = useState<string | null>(null);
  const allChannels = useMemo(() => [{ ...QR_CHANNEL, phone: qrPhone }, ...channels], [channels, qrPhone]);
  const [channelKey, setChannelKey] = useState("qr");
  const [list, setList] = useState<InboxList | null>(demo ? { ready: true, conversations: demoConversations } : null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ id: string; messages: InboxMessageItem[] } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [readLocally, setReadLocally] = useState<string[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  // Conversation list, refreshed every few seconds while the page is visible.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      fetch("/api/whatsapp/inbox", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then((body: InboxList | null) => {
        if (!cancelled && body) { setList(body); setNow(new Date()); }
      }).catch(() => undefined);
    };
    load();
    fetch("/api/whatsapp/qr", { cache: "no-store" }).then(response => response.ok ? response.json() : null)
      .then((status: { state?: string; phone?: string | null } | null) => { if (!cancelled && status?.state === "connected") setQrPhone(status.phone ?? null); }).catch(() => undefined);
    const timer = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [demo]);

  // Open conversation: messages refreshed while it stays open, and marked as read.
  useEffect(() => {
    if (!openId || demo) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      fetch(`/api/whatsapp/inbox/${openId}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null)
        .then((body: { conversation: InboxConversation | null; messages: InboxMessageItem[] } | null) => {
          if (cancelled || !body) return;
          setThread({ id: openId, messages: body.messages });
          if (body.conversation?.unread) fetch(`/api/whatsapp/inbox/${openId}`, { method: "POST", body: JSON.stringify({ action: "read" }) }).catch(() => undefined);
        }).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [openId, demo]);

  const messages = demo ? openId ? demoThreads[openId] ?? [] : [] : thread?.id === openId ? thread.messages : null;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages?.length, openId]);

  const conversations = (list?.conversations ?? []).map(item => readLocally.includes(item.id) ? { ...item, unread: 0 } : item);
  const unreadByChannel = new Map<string, number>();
  for (const item of conversations) if (item.unread) unreadByChannel.set(item.channelKey, (unreadByChannel.get(item.channelKey) ?? 0) + 1);
  const inChannel = conversations.filter(item => item.channelKey === channelKey);
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const visible = inChannel.filter(item => (filter === "all" || (filter === "unread" && item.unread > 0) || (filter === "favorites" && item.favorite) || (filter === "groups" && item.isGroup))
    && (!search || `${conversationTitle(item)} ${item.remoteId} ${item.clientName ?? ""} ${item.preview ?? ""}`.toLocaleLowerCase("pt-BR").includes(search)));
  const unreadHere = inChannel.filter(item => item.unread > 0).length;
  const open = conversations.find(item => item.id === openId) ?? null;
  const channel = allChannels.find(item => item.key === channelKey) ?? allChannels[0];

  function choose(id: string) {
    setOpenId(id);
    setReadLocally(current => current.includes(id) ? current : [...current, id]);
  }
  function toggleFavorite(item: InboxConversation) {
    if (demo) return;
    setList(current => current && { ...current, conversations: current.conversations.map(entry => entry.id === item.id ? { ...entry, favorite: !item.favorite } : entry) });
    fetch(`/api/whatsapp/inbox/${item.id}`, { method: "POST", body: JSON.stringify({ action: "favorite", value: !item.favorite }) }).catch(() => undefined);
  }

  return <div className={`wa-shell${openId ? " is-chat-open" : ""}`}>
    <nav className="wa-rail" aria-label="Números de WhatsApp">
      {allChannels.map(item => {
        const unread = unreadByChannel.get(item.key) ?? 0;
        return <button key={item.key} type="button" className={`wa-rail-item${item.key === channelKey ? " is-active" : ""}`} aria-pressed={item.key === channelKey}
          title={`${item.name}${item.phone ? ` · ${item.phone}` : ""}${item.kind === "official" ? item.coexistence ? " · API com coexistência" : " · API oficial" : " · QR Code"}`}
          onClick={() => { setChannelKey(item.key); setOpenId(null); setFilter("all"); }}>
          {item.kind === "qr" ? <QrCode size={21} /> : <span className="wa-rail-initials" style={{ background: colorFor(item.key) }}>{initialsOf(item.name)}</span>}
          {unread > 0 && <span className="wa-rail-badge">{unread > 99 ? "99+" : unread}</span>}
        </button>;
      })}
    </nav>

    <section className="wa-list" aria-label="Conversas">
      <header className="wa-list-head">
        <div><h2>Conversas</h2><small>{channel.name}{channel.phone ? ` · ${channel.phone}` : ""}</small></div>
        <div className="wa-head-actions">
          <button type="button" className="wa-icon-button" disabled title="Nova conversa · em breve"><Plus size={20} /></button>
          <button type="button" className="wa-icon-button" disabled title="Mais opções · em breve"><MoreVertical size={20} /></button>
        </div>
      </header>
      <label className="wa-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar ou começar uma nova conversa" aria-label="Pesquisar conversas" /></label>
      <div className="wa-filters" role="group" aria-label="Filtrar conversas">
        {([["all", "Tudo"], ["unread", unreadHere ? `Não lidas ${unreadHere}` : "Não lidas"], ["favorites", "Favoritas"], ...(channel.kind === "qr" ? [["groups", "Grupos"]] : [])] as Array<[Filter, string]>).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "is-active" : undefined} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      <div className="wa-rows">
        {!list && <p className="wa-list-note">Carregando conversas…</p>}
        {list && !list.ready && <p className="wa-list-note">A caixa de entrada precisa da atualização do banco de dados. Assim que ela for aplicada, as conversas passam a aparecer aqui.</p>}
        {list?.ready && !visible.length && <p className="wa-list-note">{search ? "Nenhuma conversa encontrada." : filter === "all" ? "As conversas deste número aparecem aqui a partir de agora, conforme as mensagens chegam ou são enviadas." : "Nenhuma conversa neste filtro."}</p>}
        {visible.map(item => <ConversationRow key={item.id} item={item} active={item.id === openId} now={now} onOpen={() => choose(item.id)} />)}
      </div>
    </section>

    <section className="wa-chat" aria-label="Conversa">
      {!open ? <div className="wa-empty">
        <div className="wa-empty-icon"><MessageSquareText size={44} strokeWidth={1.4} /></div>
        <h3>WhatsApp na iGrow</h3>
        <p>Escolha uma conversa para ver as mensagens. As respostas dos seus clientes aos relatórios aparecem aqui, junto com o que foi enviado por cada número.</p>
        <span className="wa-empty-lock"><Lock size={13} />Visível só para a equipe com acesso ao WhatsApp</span>
      </div> : <>
        <header className="wa-chat-head">
          <button type="button" className="wa-icon-button wa-back" onClick={() => setOpenId(null)} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button>
          <Avatar item={open} size={40} />
          <div className="wa-chat-title"><strong>{conversationTitle(open)}</strong>
            <small>{[open.isGroup ? "Grupo" : open.title ? formatWhatsAppPhone(open.remoteId) : null, open.clientName ? `Cliente: ${open.clientName}` : null].filter(Boolean).join(" · ") || channel.name}</small></div>
          <div className="wa-head-actions">
            <button type="button" className={`wa-icon-button${open.favorite ? " is-on" : ""}`} onClick={() => toggleFavorite(open)} aria-pressed={open.favorite} title={open.favorite ? "Remover das favoritas" : "Favoritar"}><Star size={19} /></button>
            <button type="button" className="wa-icon-button" disabled title="Mais opções · em breve"><MoreVertical size={20} /></button>
          </div>
        </header>
        <div className="wa-messages">
          <div className="wa-messages-inner">
            {messages === null && <p className="wa-day"><span>Carregando…</span></p>}
            {messages?.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || dayKey(previous.sentAt) !== dayKey(message.sentAt);
              const grouped = !newDay && previous?.direction === message.direction && previous.author === message.author;
              return <Fragment key={message.id}>
                {newDay && <p className="wa-day"><span>{dayLabel(message.sentAt, now)}</span></p>}
                <Bubble message={message} tail={!grouped} showAuthor={open.isGroup && message.direction === "in" && !grouped} />
              </Fragment>;
            })}
            <div ref={bottom} />
          </div>
        </div>
        <footer className="wa-composer">
          <button type="button" className="wa-icon-button" disabled title="Anexar · em breve"><Plus size={22} /></button>
          <button type="button" className="wa-icon-button" disabled title="Emojis · em breve"><Smile size={22} /></button>
          <input disabled placeholder={channel.kind === "qr" ? "Responder pela iGrow chega na próxima etapa" : "Responder pela iGrow chega na próxima etapa (até 24 h depois da mensagem do cliente)"} aria-label="Mensagem" />
          <button type="button" className="wa-icon-button" disabled title="Áudio · em breve"><Mic size={22} /></button>
        </footer>
      </>}
    </section>
  </div>;
}

function Avatar({ item, size }: { item: InboxConversation; size: number }) {
  const title = conversationTitle(item);
  const style = { width: size, height: size };
  if (item.isGroup) return <span className="wa-avatar is-icon" style={style}><UsersRound size={size * .5} /></span>;
  if (!item.title) return <span className="wa-avatar is-icon" style={style}><Contact size={size * .5} /></span>;
  return <span className="wa-avatar" style={{ ...style, background: colorFor(title) }}>{initialsOf(title)}</span>;
}

function Ticks({ status }: { status: InboxStatus }) {
  if (status === "read") return <CheckCheck size={16} className="wa-tick is-read" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck size={16} className="wa-tick" aria-label="Entregue" />;
  if (status === "failed") return <AlertCircle size={14} className="wa-tick is-failed" aria-label="Não enviada" />;
  if (status === "pending") return <Clock3 size={13} className="wa-tick" aria-label="Enviando" />;
  return <Check size={16} className="wa-tick" aria-label="Enviada" />;
}

const KIND_ICONS: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: Mic, document: FileText, sticker: Sticker, location: MapPin, contact: Contact };

function ConversationRow({ item, active, now, onOpen }: { item: InboxConversation; active: boolean; now: Date; onOpen: () => void }) {
  const Icon = item.lastKind ? KIND_ICONS[item.lastKind] : undefined;
  const preview = item.preview || kindLabel(item.lastKind);
  return <button type="button" className={`wa-row${active ? " is-active" : ""}`} onClick={onOpen}>
    <Avatar item={item} size={49} />
    <span className="wa-row-main">
      <span className="wa-row-top"><strong>{conversationTitle(item)}</strong><time className={item.unread ? "is-unread" : undefined}>{listTime(item.lastAt, now)}</time></span>
      <span className="wa-row-bottom">
        <span className="wa-row-preview">
          {item.lastDirection === "out" && <Ticks status={item.lastStatus} />}
          {Icon && <Icon size={15} className="wa-row-kind" />}
          <span>{preview}</span>
        </span>
        {item.favorite && <Star size={13} className="wa-row-star" aria-label="Favorita" />}
        {item.unread > 0 && <span className="wa-unread">{item.unread}</span>}
      </span>
      {item.clientName && <span className="wa-row-client">{item.clientName}</span>}
    </span>
  </button>;
}

function Bubble({ message, tail, showAuthor }: { message: InboxMessageItem; tail: boolean; showAuthor: boolean }) {
  const out = message.direction === "out";
  const meta = <span className="wa-meta">{clockTime(message.sentAt)}{out && <Ticks status={message.status} />}</span>;
  const Icon = KIND_ICONS[message.kind];
  return <div className={`wa-bubble-row ${out ? "is-out" : "is-in"}`}>
    <div className={`wa-bubble${tail ? " has-tail" : ""}${message.kind === "reaction" ? " is-reaction" : ""}`}>
      {showAuthor && message.author && <span className="wa-author" style={{ color: colorFor(message.author) }}>{message.author}</span>}
      {message.kind === "document" && <div className="wa-document">
        <span className="wa-document-icon"><FileText size={22} /><small>{(message.mediaName?.split(".").pop() ?? "PDF").slice(0, 4).toUpperCase()}</small></span>
        <span className="wa-document-name">{message.mediaName ?? "Documento"}</span>
      </div>}
      {message.kind === "audio" && <div className="wa-audio"><span className="wa-audio-play"><Play size={18} /></span><span className="wa-audio-wave" aria-hidden /><small>Áudio</small></div>}
      {Icon && message.kind !== "document" && message.kind !== "audio" && <div className="wa-media"><Icon size={18} />{kindLabel(message.kind)}{message.kind === "contact" || message.kind === "location" ? message.body ? `: ${message.body}` : "" : ""}</div>}
      {message.kind === "template" && !message.body && <div className="wa-media"><FileText size={18} />Mensagem modelo</div>}
      {message.kind === "other" && !message.body && <div className="wa-media">Mensagem não suportada nesta tela</div>}
      {message.body && message.kind !== "contact" && message.kind !== "location" && <p className="wa-text">{message.body}{meta}</p>}
      {(!message.body || message.kind === "contact" || message.kind === "location") && <div className="wa-meta-row">{meta}</div>}
    </div>
  </div>;
}
