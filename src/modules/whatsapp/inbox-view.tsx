"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Archive, ArrowLeft, BadgeCheck, Download, Loader2, Pause, Check, CheckCheck, Clock3, Contact, FileText, Image as ImageIcon, Lock, MapPin, MessageSquareText, Mic, MoreVertical, Play, Plus, QrCode, Search, SendHorizontal, Smile, Star, Sticker, Trash2, UsersRound, Video, X, Headphones } from "lucide-react";
import { clockTime, colorFor, conversationTitle, dayKey, dayLabel, formatWhatsAppPhone, initialsOf, kindLabel, listTime, phoneKey } from "./inbox-format";
import type { InboxChannel, InboxContact, InboxConversation, InboxList, InboxMessageItem, InboxStatus } from "./inbox-types";
import { EmojiPicker } from "./emoji-picker";
import { WhatsAppText } from "./inbox-text";
import { ACCEPTED_REPLY_FILES, MAX_REPLY_FILE_BYTES, MAX_REPLY_TEXT, replyMediaKind, replyWindow } from "./reply-rules";
import { optimisticReadApplies, optimisticReadSnapshot, type OptimisticRead } from "./inbox-unread";
import { latestInboxCursor, reconcileInboxList } from "./inbox-merge";
import "./inbox.css";

type Filter = "all" | "unread" | "favorites" | "groups";
const QR_CHANNEL: InboxChannel = { key: "qr", kind: "qr", name: "Seu WhatsApp", phone: null, coexistence: false };

/**
 * WhatsApp inbox in the layout of WhatsApp Desktop: numbers on the left rail, conversations,
 * and the open chat, where the team replies with text, emojis and files.
 */
export function WhatsAppInbox({ channels, demo = false, canReply = true, contacts = [], demoConversations = [], demoThreads = {} }: {
  channels: InboxChannel[]; demo?: boolean; canReply?: boolean; contacts?: InboxContact[]; demoConversations?: InboxConversation[]; demoThreads?: Record<string, InboxMessageItem[]>;
}) {
  // "Nova conversa": the picker on the left and, until the first message, a draft chat on the right.
  const [picking, setPicking] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ phone: string; name: string | null; clientName: string | null } | null>(null);
  // Messages being sent (or sent in the demo), shown until the conversation reloads from the server.
  const [outbox, setOutbox] = useState<Record<string, InboxMessageItem[]>>({});
  const [qrPhone, setQrPhone] = useState<string | null>(null);
  const allChannels = useMemo(() => [{ ...QR_CHANNEL, phone: qrPhone }, ...channels], [channels, qrPhone]);
  const [channelKey, setChannelKey] = useState("qr");
  const [list, setList] = useState<InboxList | null>(demo ? { ready: true, conversations: demoConversations } : null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ id: string; messages: InboxMessageItem[] } | null>(null);
  const [now, setNow] = useState(() => new Date());
  // Only suppress the badge for the message snapshot that was opened, never for future messages.
  const [readLocally, setReadLocally] = useState<Record<string, OptimisticRead>>({});
  const [actionError, setActionError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  // Initial full load, then small deltas every 5 seconds; reconcile deletions every 5 minutes.
  // Skip inactive tabs and avoid overlapping requests so a slow poll cannot overwrite fresh data.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    let inFlight = false;
    let since: string | null = null;
    let lastFull = 0;
    const load = async (forceFull = false) => {
      if (document.hidden || inFlight || cancelled) return;
      const full = forceFull || !since || Date.now() - lastFull >= 300_000;
      inFlight = true;
      try {
        const url = full ? "/api/whatsapp/inbox" : `/api/whatsapp/inbox?since=${encodeURIComponent(since!)}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as InboxList;
        if (cancelled || !body.ready) return;
        setList(previous => reconcileInboxList(previous, body));
        since = latestInboxCursor(full ? null : since, body.conversations);
        if (full) lastFull = Date.now();
        setNow(new Date());
        setReadLocally(current => {
          const byId = new Map(body.conversations.map(item => [item.id, item]));
          const next = { ...current };
          let changed = false;
          const at = Date.now();
          for (const [id, marker] of Object.entries(current)) {
            const item = byId.get(id);
            if ((item && !optimisticReadApplies(item, marker, at)) || (!item && (full || at >= marker.expiresAt))) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? next : current;
        });
      } catch {
        // Keep the last good list until the next poll.
      } finally {
        inFlight = false;
      }
    };
    void load(true);
    fetch("/api/whatsapp/qr", { cache: "no-store" }).then(response => response.ok ? response.json() : null)
      .then((status: { state?: string; phone?: string | null } | null) => { if (!cancelled && status?.state === "connected") setQrPhone(status.phone ?? null); }).catch(() => undefined);
    const timer = setInterval(() => void load(), 5000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
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

  const loaded = demo ? openId ? demoThreads[openId] ?? [] : [] : thread?.id === openId ? thread.messages : null;
  const pending = openId ? outbox[openId] ?? [] : [];
  const messages = loaded ? [...loaded, ...pending] : pending.length ? pending : null;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages?.length, openId]);

  function queue(conversationId: string, item: InboxMessageItem) {
    setOutbox(current => ({ ...current, [conversationId]: [...(current[conversationId] ?? []), item] }));
  }
  function settle(conversationId: string, itemId: string, status: InboxStatus) {
    setOutbox(current => ({ ...current, [conversationId]: (current[conversationId] ?? []).map(item => item.id === itemId ? { ...item, status } : item) }));
  }
  // After a send, reload the conversation and drop the local copies it now includes.
  function reload(conversationId: string) {
    fetch(`/api/whatsapp/inbox/${conversationId}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null)
      .then((body: { messages: InboxMessageItem[] } | null) => {
        if (!body) return;
        setThread(current => current?.id === conversationId || openId === conversationId ? { id: conversationId, messages: body.messages } : current);
        setOutbox(current => ({ ...current, [conversationId]: (current[conversationId] ?? []).filter(item => item.status === "failed") }));
      }).catch(() => undefined);
  }

  const conversations = (list?.conversations ?? []).map(item =>
    optimisticReadApplies(item, readLocally[item.id], now.getTime()) ? { ...item, unread: 0 } : item);
  // Archived conversations stay out of the counters, as in WhatsApp.
  const unreadByChannel = new Map<string, number>();
  for (const item of conversations) if (item.unread && !item.archived) unreadByChannel.set(item.channelKey, (unreadByChannel.get(item.channelKey) ?? 0) + 1);
  const archivedHere = conversations.filter(item => item.channelKey === channelKey && item.archived);
  const inChannel = conversations.filter(item => item.channelKey === channelKey && item.archived === showArchived);
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const visible = inChannel.filter(item => (filter === "all" || (filter === "unread" && item.unread > 0) || (filter === "favorites" && item.favorite) || (filter === "groups" && item.isGroup))
    && (!search || `${conversationTitle(item)} ${item.remoteId} ${item.clientName ?? ""} ${item.preview ?? ""}`.toLocaleLowerCase("pt-BR").includes(search)));
  const unreadHere = inChannel.filter(item => item.unread > 0).length;
  const open = conversations.find(item => item.id === openId) ?? null;
  const channel = allChannels.find(item => item.key === channelKey) ?? allChannels[0];

  function startWith(contact: { phone: string; name: string | null; clientName: string | null }) {
    setPicking(false);
    const existing = conversations.find(item => item.channelKey === "qr" && !item.isGroup && phoneKey(item.remoteId) === phoneKey(contact.phone));
    if (existing) { setDraft(null); choose(existing.id); return; }
    setOpenId(null); setDraft(contact);
  }
  function started(conversationId: string | null) {
    setDraft(null);
    if (!conversationId) return;
    setOpenId(conversationId);
    fetch("/api/whatsapp/inbox", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then((body: InboxList | null) => { if (body) setList(body); }).catch(() => undefined);
  }

  function choose(id: string) {
    setDraft(null);
    setMenuOpen(false);
    setOpenId(id);
    const selected = list?.conversations.find(item => item.id === id);
    if (!demo && selected?.unread) {
      setReadLocally(current => ({ ...current, [id]: optimisticReadSnapshot(selected, Date.now()) }));
    }
  }
  async function toggleArchived(item: InboxConversation) {
    setMenuOpen(false);
    if (demo) return;
    setActionError("");
    setList(current => current && { ...current, conversations: current.conversations.map(entry => entry.id === item.id ? { ...entry, archived: !item.archived } : entry) });
    if (!item.archived) setOpenId(null);
    try {
      const response = await fetch(`/api/whatsapp/inbox/${item.id}`, { method: "POST", body: JSON.stringify({ action: "archive", value: !item.archived }) });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "O WhatsApp não confirmou o arquivamento.");
      }
    } catch (error) {
      // Never leave a misleading archived badge after a rejected phone operation.
      setList(current => current && { ...current, conversations: current.conversations.map(entry => entry.id === item.id ? { ...entry, archived: item.archived } : entry) });
      setActionError(error instanceof Error ? error.message : "Não foi possível sincronizar o arquivamento.");
    }
  }
  function toggleFavorite(item: InboxConversation) {
    if (demo) return;
    setList(current => current && { ...current, conversations: current.conversations.map(entry => entry.id === item.id ? { ...entry, favorite: !item.favorite } : entry) });
    fetch(`/api/whatsapp/inbox/${item.id}`, { method: "POST", body: JSON.stringify({ action: "favorite", value: !item.favorite }) }).catch(() => undefined);
  }

  return <div className={`wai-shell${openId || draft ? " is-chat-open" : ""}`}>
    <nav className="wai-rail" aria-label="Números de WhatsApp">
      {allChannels.map(item => {
        const unread = unreadByChannel.get(item.key) ?? 0;
        return <button key={item.key} type="button" className={`wai-rail-item${item.key === channelKey ? " is-active" : ""}`} aria-pressed={item.key === channelKey}
          title={`${item.name}${item.phone ? ` · ${item.phone}` : ""}${item.kind === "official" ? item.coexistence ? " · API com coexistência" : " · API oficial" : " · QR Code"}`}
          onClick={() => { setChannelKey(item.key); setOpenId(null); setDraft(null); setPicking(false); setShowArchived(false); setFilter("all"); }}>
          {item.kind === "qr" ? <QrCode size={21} /> : /\p{L}/u.test(item.name)
            ? <span className="wai-rail-initials" style={{ background: colorFor(item.key) }}>{initialsOf(item.name)}</span>
            : <span className="wai-rail-initials is-icon" style={{ background: colorFor(item.key) }}><BadgeCheck size={17} /></span>}
          {unread > 0 && <span className="wai-rail-badge">{unread > 99 ? "99+" : unread}</span>}
        </button>;
      })}
    </nav>

    <section className="wai-list" aria-label="Conversas">
      <header className="wai-list-head">
        <div><h2>Conversas</h2><small>{channel.name}{channel.phone ? ` · ${channel.phone}` : ""}</small></div>
        <div className="wai-head-actions">
          <button type="button" className={`wai-icon-button${picking ? " is-on" : ""}`} disabled={channel.kind !== "qr" || !canReply} onClick={() => setPicking(value => !value)}
            title={channel.kind !== "qr" ? "Nos números oficiais, uma conversa nova só começa com mensagem modelo aprovada" : "Nova conversa"}><Plus size={20} /></button>
          <button type="button" className="wai-icon-button" disabled title="Mais opções · em breve"><MoreVertical size={20} /></button>
        </div>
      </header>
      {actionError && <p role="alert" className="wai-list-note">{actionError}</p>}
      {picking ? <NewChat contacts={contacts} onPick={startWith} onClose={() => setPicking(false)} /> : showArchived ? <>
      <div className="wai-new-head"><button type="button" className="wai-icon-button" onClick={() => setShowArchived(false)} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button><strong>Arquivadas</strong></div>
      <p className="wai-new-note">As conversas arquivadas no celular também aparecem aqui após a sincronização do WhatsApp. Alterações podem levar alguns instantes para atualizar.</p>
      <div className="wai-rows">
        {!inChannel.length && <p className="wai-list-note">Nenhuma conversa arquivada.</p>}
        {inChannel.map(item => <ConversationRow key={item.id} item={item} active={item.id === openId} now={now} photo={!demo} onOpen={() => choose(item.id)} />)}
      </div>
      </> : <>
      <label className="wai-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar ou começar uma nova conversa" aria-label="Pesquisar conversas" /></label>
      <div className="wai-filters" role="group" aria-label="Filtrar conversas">
        {([["all", "Tudo"], ["unread", unreadHere ? `Não lidas ${unreadHere}` : "Não lidas"], ["favorites", "Favoritas"], ...(channel.kind === "qr" ? [["groups", "Grupos"]] : [])] as Array<[Filter, string]>).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "is-active" : undefined} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      <div className="wai-rows">
        {archivedHere.length > 0 && <button type="button" className="wai-archived-row" onClick={() => { setShowArchived(true); setFilter("all"); }}>
          <Archive size={20} /><span>Arquivadas</span>{archivedHere.some(item => item.unread) && <small>{archivedHere.filter(item => item.unread).length}</small>}
        </button>}
        {!list && <p className="wai-list-note">Carregando conversas…</p>}
        {list && !list.ready && <p className="wai-list-note">A caixa de entrada precisa da atualização do banco de dados. Assim que ela for aplicada, as conversas passam a aparecer aqui.</p>}
        {list?.ready && !visible.length && <p className="wai-list-note">{search ? "Nenhuma conversa encontrada." : filter === "all" ? "As conversas deste número aparecem aqui a partir de agora, conforme as mensagens chegam ou são enviadas." : "Nenhuma conversa neste filtro."}</p>}
        {visible.map(item => <ConversationRow key={item.id} item={item} active={item.id === openId} now={now} photo={!demo} onOpen={() => choose(item.id)} />)}
      </div>
      </>}
    </section>

    {viewer && <PhotoViewer src={viewer} onClose={() => setViewer(null)} />}
    <section className={`wai-chat${draft ? " has-draft" : ""}`} aria-label="Conversa">
      {draft && !open ? <DraftChat key={draft.phone} draft={draft} demo={demo} onClose={() => setDraft(null)} onStarted={started} /> : !open ? <div className="wai-empty">
        <div className="wai-empty-icon"><MessageSquareText size={44} strokeWidth={1.4} /></div>
        <h3>WhatsApp na iGrow</h3>
        <p>Escolha uma conversa para ver as mensagens. As respostas dos seus clientes aos relatórios aparecem aqui, junto com o que foi enviado por cada número.</p>
        <span className="wai-empty-lock"><Lock size={13} />Visível só para a equipe com acesso ao WhatsApp</span>
      </div> : <>
        <header className="wai-chat-head">
          <button type="button" className="wai-icon-button wai-back" onClick={() => setOpenId(null)} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button>
          <Avatar key={open.id} item={open} size={40} photo={!demo} />
          <div className="wai-chat-title"><strong>{conversationTitle(open)}</strong>
            <small>{[open.isGroup ? "Grupo" : open.title ? formatWhatsAppPhone(open.remoteId) : null, open.clientName ? `Cliente: ${open.clientName}` : null].filter(Boolean).join(" · ") || channel.name}</small></div>
          <div className="wai-head-actions">
            <button type="button" className={`wai-icon-button${open.favorite ? " is-on" : ""}`} onClick={() => toggleFavorite(open)} aria-pressed={open.favorite} title={open.favorite ? "Remover das favoritas" : "Favoritar"}><Star size={19} /></button>
            <div className="wai-head-menu">
              <button type="button" className={`wai-icon-button${menuOpen ? " is-on" : ""}`} onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-label="Mais opções"><MoreVertical size={20} /></button>
              {menuOpen && <div className="wai-attach-menu wai-chat-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => toggleArchived(open)}><Archive size={18} />{open.archived ? "Desarquivar conversa" : "Arquivar conversa"}</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); toggleFavorite(open); }}><Star size={18} />{open.favorite ? "Remover das favoritas" : "Adicionar às favoritas"}</button>
              </div>}
            </div>
          </div>
        </header>
        <div className="wai-messages">
          <div className="wai-messages-inner">
            {messages === null && <p className="wai-day"><span>Carregando…</span></p>}
            {messages?.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || dayKey(previous.sentAt) !== dayKey(message.sentAt);
              const grouped = !newDay && previous?.direction === message.direction && previous.author === message.author;
              return <Fragment key={message.id}>
                {newDay && <p className="wai-day"><span>{dayLabel(message.sentAt, now)}</span></p>}
                <Bubble message={message} tail={!grouped} showAuthor={open.isGroup && message.direction === "in" && !grouped} live={!demo && !message.id.startsWith("local-")} onView={setViewer} />
              </Fragment>;
            })}
            <div ref={bottom} />
          </div>
        </div>
        <Composer key={open.id} conversation={open} kind={channel.kind} now={now} demo={demo} canReply={canReply}
          onQueued={item => queue(open.id, item)} onSettled={(itemId, status) => settle(open.id, itemId, status)} onSent={() => { if (!demo) reload(open.id); }} />
      </>}
    </section>
  </div>;
}

// Profile photo from WhatsApp (QR Code session only) over the initials, which stay if there is none.
function Avatar({ item, size, photo }: { item: InboxConversation; size: number; photo: boolean }) {
  const [failed, setFailed] = useState(false);
  const title = conversationTitle(item);
  const style = { width: size, height: size };
  const fallback = item.isGroup ? <UsersRound size={size * .5} /> : !item.title ? <Contact size={size * .5} /> : initialsOf(title);
  return <span className={`wai-avatar${item.isGroup || !item.title ? " is-icon" : ""}`} style={item.isGroup || !item.title ? style : { ...style, background: colorFor(title) }}>
    {fallback}
    {photo && item.channelKey === "qr" && !failed && /* eslint-disable-next-line @next/next/no-img-element -- private photo streamed from WhatsApp */
      <img src={`/api/whatsapp/inbox/avatar/${item.id}`} alt="" loading="lazy" onError={() => setFailed(true)} />}
  </span>;
}

function Ticks({ status }: { status: InboxStatus }) {
  if (status === "read") return <CheckCheck size={16} className="wai-tick is-read" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck size={16} className="wai-tick" aria-label="Entregue" />;
  if (status === "failed") return <AlertCircle size={14} className="wai-tick is-failed" aria-label="Não enviada" />;
  if (status === "pending") return <Clock3 size={13} className="wai-tick" aria-label="Enviando" />;
  return <Check size={16} className="wai-tick" aria-label="Enviada" />;
}

const KIND_ICONS: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: Mic, document: FileText, sticker: Sticker, location: MapPin, contact: Contact };

function ConversationRow({ item, active, now, photo, onOpen }: { item: InboxConversation; active: boolean; now: Date; photo: boolean; onOpen: () => void }) {
  const Icon = item.lastKind ? KIND_ICONS[item.lastKind] : undefined;
  const preview = item.preview || kindLabel(item.lastKind);
  return <button type="button" className={`wai-row${active ? " is-active" : ""}`} onClick={onOpen}>
    <Avatar item={item} size={49} photo={photo} />
    <span className="wai-row-main">
      <span className="wai-row-top"><strong>{conversationTitle(item)}</strong><time className={item.unread ? "is-unread" : undefined}>{listTime(item.lastAt, now)}</time></span>
      <span className="wai-row-bottom">
        <span className="wai-row-preview">
          {item.lastDirection === "out" && <Ticks status={item.lastStatus} />}
          {Icon && <Icon size={15} className="wai-row-kind" />}
          <span>{preview}</span>
        </span>
        {item.favorite && <Star size={13} className="wai-row-star" aria-label="Favorita" />}
        {item.unread > 0 && <span className="wai-unread">{item.unread}</span>}
      </span>
      {item.clientName && <span className="wai-row-client">{item.clientName}</span>}
    </span>
  </button>;
}

// Files open from WhatsApp only when shown (not stored by the iGrow); a failure falls back to the label.
function MediaImage({ src, sticker, onView }: { src: string; sticker: boolean; onView: (src: string) => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="wai-media"><ImageIcon size={18} />{sticker ? "Figurinha" : "Foto"} indisponível</div>;
  return <button type="button" className={sticker ? "wai-sticker" : "wai-photo"} onClick={() => { if (!sticker) onView(src); }} aria-label={sticker ? "Figurinha" : "Abrir foto"}>
    {/* eslint-disable-next-line @next/next/no-img-element -- private file streamed from WhatsApp */}
    <img src={src} alt={sticker ? "Figurinha" : "Foto"} loading="lazy" onError={() => setFailed(true)} />
  </button>;
}

/** Full-screen photo, as WhatsApp opens it: close with the X, Esc or a click outside; download keeps the original. */
function PhotoViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="wai-viewer" role="dialog" aria-modal="true" aria-label="Foto" onClick={onClose}>
    <div className="wai-viewer-bar" onClick={event => event.stopPropagation()}>
      <a className="wai-icon-button" href={`${src}?baixar`} aria-label="Baixar foto" title="Baixar"><Download size={20} /></a>
      <button type="button" className="wai-icon-button" onClick={onClose} aria-label="Fechar" title="Fechar"><X size={22} /></button>
    </div>
    {/* eslint-disable-next-line @next/next/no-img-element -- private file streamed from WhatsApp */}
    <img src={src} alt="Foto" onClick={event => event.stopPropagation()} />
  </div>;
}

/** Voice and audio messages: WhatsApp-like player; the file downloads only when played. */
function AudioPlayer({ src, out }: { src: string; out: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const [speed, setSpeed] = useState(1);
  useEffect(() => () => { audio.current?.pause(); if (url.current) URL.revokeObjectURL(url.current); }, []);

  async function toggle() {
    if (state === "playing") { audio.current?.pause(); return; }
    if (audio.current) { void audio.current.play(); return; }
    setState("loading");
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error();
      url.current = URL.createObjectURL(await response.blob());
      const element = new Audio(url.current);
      element.playbackRate = speed;
      element.onloadedmetadata = () => setTime({ current: 0, duration: Number.isFinite(element.duration) ? element.duration : 0 });
      element.ontimeupdate = () => setTime({ current: element.currentTime, duration: Number.isFinite(element.duration) ? element.duration : element.currentTime });
      element.onplay = () => setState("playing");
      element.onpause = () => setState("paused");
      element.onended = () => { element.currentTime = 0; setState("paused"); };
      audio.current = element;
      await element.play();
    } catch { setState("error"); }
  }
  function seek(value: number) { if (audio.current && time.duration) audio.current.currentTime = value; }
  function cycleSpeed() { const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1; setSpeed(next); if (audio.current) audio.current.playbackRate = next; }
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  if (state === "error") return <div className="wai-media"><Mic size={18} />Áudio indisponível</div>;
  return <div className={`wai-voice${out ? " is-out" : ""}`}>
    <button type="button" className="wai-voice-play" onClick={() => void toggle()} aria-label={state === "playing" ? "Pausar áudio" : "Tocar áudio"}>
      {state === "loading" ? <Loader2 size={20} className="wai-spin" /> : state === "playing" ? <Pause size={20} /> : <Play size={20} />}
    </button>
    <div className="wai-voice-track">
      <input type="range" min={0} max={time.duration || 1} step={0.1} value={time.current} onChange={event => seek(Number(event.target.value))} disabled={!time.duration} aria-label="Posição do áudio"
        style={{ "--wai-progress": `${time.duration ? (time.current / time.duration) * 100 : 0}%` } as React.CSSProperties} />
      <small>{state === "idle" ? "Áudio" : clock(state === "playing" || time.current ? time.current : time.duration)}</small>
    </div>
    {state !== "idle" && <button type="button" className="wai-voice-speed" onClick={cycleSpeed} aria-label="Velocidade">{speed}×</button>}
  </div>;
}

function Bubble({ message, tail, showAuthor, live, onView }: { message: InboxMessageItem; tail: boolean; showAuthor: boolean; live: boolean; onView: (src: string) => void }) {
  const out = message.direction === "out";
  const meta = <span className="wai-meta">{clockTime(message.sentAt)}{out && <Ticks status={message.status} />}</span>;
  const src = `/api/whatsapp/inbox/media/${message.id}`;
  const shownLive = live && (message.kind === "image" || message.kind === "sticker" || message.kind === "video" || message.kind === "audio");
  const Icon = shownLive ? undefined : KIND_ICONS[message.kind];
  return <div className={`wai-bubble-row ${out ? "is-out" : "is-in"}`}>
    <div className={`wai-bubble${tail ? " has-tail" : ""}${message.kind === "reaction" ? " is-reaction" : ""}`}>
      {showAuthor && message.author && <span className="wai-author" style={{ color: colorFor(message.author) }}>{message.author}</span>}
      {message.kind === "document" && <div className="wai-document">
        <span className="wai-document-icon"><FileText size={22} /><small>{(message.mediaName?.split(".").pop() ?? "PDF").slice(0, 4).toUpperCase()}</small></span>
        <span className="wai-document-name">{message.mediaName ?? "Documento"}</span>
      </div>}
      {message.kind === "document" && live && <div className="wai-document-actions">
        <a href={src} target="_blank" rel="noopener noreferrer">Ver</a><a href={`${src}?baixar`}>Salvar como…</a>
      </div>}
      {live && (message.kind === "image" || message.kind === "sticker") && <MediaImage src={src} sticker={message.kind === "sticker"} onView={onView} />}
      {live && message.kind === "video" && <video className="wai-video" controls preload="none" src={src} />}
      {live && message.kind === "audio" && <AudioPlayer src={src} out={out} />}
      {!live && message.kind === "audio" && <div className="wai-audio"><span className="wai-audio-play"><Play size={18} /></span><span className="wai-audio-wave" aria-hidden /><small>Áudio</small></div>}
      {Icon && message.kind !== "document" && message.kind !== "audio" && !(live && shownLive) && <div className="wai-media"><Icon size={18} />{kindLabel(message.kind)}{message.kind === "contact" || message.kind === "location" ? message.body ? `: ${message.body}` : "" : ""}</div>}
      {message.kind === "template" && !message.body && <div className="wai-media"><FileText size={18} />Mensagem modelo</div>}
      {message.kind === "other" && !message.body && <div className="wai-media">Mensagem não suportada nesta tela</div>}
      {message.body && message.kind !== "contact" && message.kind !== "location" && <p className="wai-text"><WhatsAppText text={message.body} />{meta}</p>}
      {(!message.body || message.kind === "contact" || message.kind === "location") && <div className="wai-meta-row">{meta}</div>}
    </div>
  </div>;
}

function formatBytes(size: number) {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/**
 * Message field: text (Enter sends, Shift+Enter breaks the line), emojis and one file with an
 * optional caption. Official numbers only reply within 24 hours of the customer's last message.
 */
function Composer({ conversation, kind, now, demo, canReply, onQueued, onSettled, onSent }: {
  conversation: InboxConversation; kind: "qr" | "official"; now: Date; demo: boolean; canReply: boolean;
  onQueued: (item: InboxMessageItem) => void; onSettled: (itemId: string, status: InboxStatus) => void; onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // "Documento" sends any file as a document; "Fotos e vídeos" and "Áudio" send it as media.
  const [asDocument, setAsDocument] = useState(false);
  const [pendingDocument, setPendingDocument] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<"attach" | "emoji" | null>(null);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const reply = replyWindow(kind, conversation.lastInboundAt, now);
  const recorder = useRef<{ media: MediaRecorder; chunks: Blob[]; stream: MediaStream; send: boolean } | null>(null);
  const [recording, setRecording] = useState<{ startedAt: number; seconds: number } | null>(null);
  // Official numbers only accept Ogg/Opus voice; Chrome records WebM, which only the QR Code server converts.
  const [voiceFormat] = useState(() => typeof MediaRecorder === "undefined" ? null
    : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus"
    : kind === "qr" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : null);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setRecording(current => current && { ...current, seconds: Math.floor((Date.now() - current.startedAt) / 1000) }), 500);
    return () => clearInterval(timer);
  }, [recording]);
  // Leaving the conversation stops the microphone.
  useEffect(() => () => { recorder.current?.stream.getTracks().forEach(track => track.stop()); }, []);

  async function startRecording() {
    if (!voiceFormat || recorder.current) return;
    setError(""); setMenu(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream, { mimeType: voiceFormat });
      const state = { media, chunks: [] as Blob[], stream, send: false };
      media.ondataavailable = event => { if (event.data.size) state.chunks.push(event.data); };
      media.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        recorder.current = null;
        setRecording(null);
        if (state.send && state.chunks.length) void sendVoice(new Blob(state.chunks, { type: voiceFormat.split(";")[0] }));
      };
      // The start time comes from the event, so the timer matches the recording.
      media.onstart = event => setRecording({ startedAt: performance.timeOrigin + event.timeStamp, seconds: 0 });
      recorder.current = state;
      media.start();
    } catch {
      setError("Não foi possível usar o microfone. Permita o acesso ao microfone no navegador.");
    }
  }
  function stopRecording(send: boolean) {
    if (!recorder.current) return;
    recorder.current.send = send;
    recorder.current.media.stop();
  }
  async function sendVoice(blob: Blob) {
    if (blob.size > MAX_REPLY_FILE_BYTES) { setError("A gravação passou de 4 MB. Grave um áudio mais curto."); return; }
    const item: InboxMessageItem = { id: `local-${Date.now()}`, direction: "out", kind: "audio", body: null, mediaName: null, mediaMime: blob.type, author: null, status: demo ? "sent" : "pending", sentAt: new Date().toISOString() };
    onQueued(item);
    if (demo) return;
    try {
      const form = new FormData();
      form.append("file", blob, blob.type.includes("ogg") ? "voz.ogg" : "voz.webm");
      form.append("voice", "1");
      const response = await fetch(`/api/whatsapp/inbox/${conversation.id}/send`, { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { onSettled(item.id, "failed"); setError(result.error ?? "Não foi possível enviar o áudio."); return; }
      onSent();
    } catch { onSettled(item.id, "failed"); setError("Sem conexão. O áudio não foi enviado."); }
  }

  function chooseFile(accept: string, document: boolean) {
    setMenu(null);
    setPendingDocument(document);
    if (!picker.current) return;
    picker.current.accept = accept;
    picker.current.click();
  }
  function onFile(selected: File | undefined) {
    if (!selected) return;
    if (!replyMediaKind(selected.type, kind, pendingDocument)) { setError("Esse tipo de arquivo não é aceito pelo WhatsApp."); return; }
    if (selected.size > MAX_REPLY_FILE_BYTES) { setError("O arquivo precisa ter até 4 MB."); return; }
    setError(""); setFile(selected); setAsDocument(pendingDocument); field.current?.focus();
  }
  function insertEmoji(emoji: string) {
    const element = field.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + emoji.length, start + emoji.length); });
  }

  async function send() {
    const body = text.trim();
    if ((!body && !file) || sending) return;
    if (body.length > MAX_REPLY_TEXT) { setError("A mensagem passou de 4.096 caracteres."); return; }
    const mediaKind = file ? replyMediaKind(file.type, kind, asDocument) : null;
    const item: InboxMessageItem = {
      id: `local-${Date.now()}`, direction: "out", kind: mediaKind ?? "text", body: body || null,
      mediaName: mediaKind === "document" ? file?.name ?? null : null, mediaMime: file?.type ?? null, author: null,
      status: demo ? "sent" : "pending", sentAt: new Date().toISOString(),
    };
    onQueued(item);
    setText(""); setFile(null); setError(""); setMenu(null);
    if (demo) return;
    setSending(true);
    try {
      const form = new FormData();
      if (body) form.append("text", body);
      if (file) form.append("file", file, file.name);
      if (file && asDocument) form.append("asDocument", "1");
      const response = await fetch(`/api/whatsapp/inbox/${conversation.id}/send`, { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { onSettled(item.id, "failed"); setError(result.error ?? "Não foi possível enviar agora."); return; }
      onSent();
    } catch {
      onSettled(item.id, "failed"); setError("Sem conexão. A mensagem não foi enviada.");
    } finally { setSending(false); }
  }

  if (!canReply) return <footer className="wai-composer-note"><Lock size={14} />Seu perfil só pode consultar as conversas.</footer>;
  if (!reply.open) return <footer className="wai-composer-note is-closed"><Clock3 size={15} />
    <span>{conversation.lastInboundAt
      ? "Passaram mais de 24 horas desde a última mensagem deste contato. Pela API oficial, só uma mensagem modelo aprovada retoma a conversa. A resposta livre volta a valer quando o contato escrever de novo."
      : "Este contato ainda não escreveu para este número. Pela API oficial, só uma mensagem modelo aprovada inicia a conversa. Quando ele responder, você pode escrever livremente por 24 horas."}</span></footer>;

  const closes = reply.closesAt;
  return <footer className="wai-composer-area">
    {error && <p role="alert" className="wai-composer-error"><AlertCircle size={14} />{error}</p>}
    {file && <div className="wai-attachment">
      <FileText size={18} /><span><strong>{file.name}</strong><small>{asDocument ? "Documento" : "Mídia"} · {formatBytes(file.size)}{text ? " · o texto vai como legenda" : ""}</small></span>
      <button type="button" className="wai-icon-button" onClick={() => setFile(null)} aria-label="Remover arquivo"><X size={16} /></button>
    </div>}
    {kind === "official" && closes && <p className="wai-window">Resposta livre até {dayLabel(closes, now).toLowerCase()} às {clockTime(closes)} · respostas pela API oficial podem ser cobradas pela Meta</p>}
    {recording ? <div className="wai-composer wai-recording">
      <button type="button" className="wai-icon-button" onClick={() => stopRecording(false)} aria-label="Descartar gravação" title="Descartar"><Trash2 size={20} /></button>
      <span className="wai-recording-dot" aria-hidden />
      <span className="wai-recording-time" aria-live="polite">{Math.floor(recording.seconds / 60)}:{String(recording.seconds % 60).padStart(2, "0")}</span>
      <span className="wai-recording-label">Gravando áudio…</span>
      <button type="button" className="wai-send" onClick={() => stopRecording(true)} aria-label="Enviar áudio"><SendHorizontal size={20} /></button>
    </div> : <div className="wai-composer">
      <div className="wai-composer-menu">
        <button type="button" className={`wai-icon-button${menu === "attach" ? " is-on" : ""}`} onClick={() => setMenu(menu === "attach" ? null : "attach")} aria-expanded={menu === "attach"} title="Anexar"><Plus size={22} /></button>
        {menu === "attach" && <div className="wai-attach-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => chooseFile(ACCEPTED_REPLY_FILES, true)}><FileText size={18} className="is-doc" />Documento</button>
          <button type="button" role="menuitem" onClick={() => chooseFile("image/jpeg,image/png,image/webp,video/mp4,video/3gpp", false)}><ImageIcon size={18} className="is-photo" />Fotos e vídeos</button>
          <button type="button" role="menuitem" onClick={() => chooseFile("audio/mpeg,audio/ogg,audio/mp4,audio/aac", false)}><Headphones size={18} className="is-audio" />Áudio</button>
        </div>}
      </div>
      <div className="wai-composer-menu">
        <button type="button" className={`wai-icon-button${menu === "emoji" ? " is-on" : ""}`} onClick={() => setMenu(menu === "emoji" ? null : "emoji")} aria-expanded={menu === "emoji"} title="Emojis"><Smile size={22} /></button>
        {menu === "emoji" && <EmojiPicker onPick={insertEmoji} />}
      </div>
      <textarea ref={field} rows={1} value={text} maxLength={MAX_REPLY_TEXT} placeholder="Digite uma mensagem" aria-label="Mensagem"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      {text.trim() || file
        ? <button type="button" className="wai-send" onClick={() => void send()} disabled={sending} aria-label="Enviar"><SendHorizontal size={20} /></button>
        : <button type="button" className="wai-icon-button" disabled={!voiceFormat} onClick={() => void startRecording()} aria-label="Gravar áudio"
          title={voiceFormat ? "Gravar áudio" : "Este navegador não grava áudio no formato aceito por este número. Envie um arquivo de áudio pelo +."}><Mic size={22} /></button>}
      <input ref={picker} type="file" hidden accept={ACCEPTED_REPLY_FILES} onChange={event => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
    </div>}
  </footer>;
}

/** "Nova conversa": the client recipients registered in the iGrow, or any number typed with DDD. */
function NewChat({ contacts, onPick, onClose }: { contacts: InboxContact[]; onPick: (contact: { phone: string; name: string | null; clientName: string | null }) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const digits = query.replace(/\D/g, "");
  const shown = contacts.filter(contact => !search || `${contact.name} ${contact.clientName ?? ""}`.toLocaleLowerCase("pt-BR").includes(search) || (digits.length >= 3 && contact.phone.replace(/\D/g, "").includes(digits)));
  const typed = digits.length >= 10 ? (digits.length <= 11 ? `55${digits}` : digits) : null;
  return <div className="wai-new">
    <div className="wai-new-head"><button type="button" className="wai-icon-button" onClick={onClose} aria-label="Voltar"><ArrowLeft size={20} /></button><strong>Nova conversa</strong></div>
    <label className="wai-search"><Search size={17} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar nome ou digitar número com DDD" aria-label="Pesquisar contato ou número" /></label>
    <p className="wai-new-note">Pelo QR Code, mande mensagem só para quem conhece seu número: mensagens para desconhecidos aumentam o risco de bloqueio.</p>
    <div className="wai-rows">
      {typed && <button type="button" className="wai-row" onClick={() => onPick({ phone: typed, name: null, clientName: null })}>
        <span className="wai-avatar is-icon" style={{ width: 49, height: 49 }}><Contact size={24} /></span>
        <span className="wai-row-main"><span className="wai-row-top"><strong>Conversar com {formatWhatsAppPhone(typed)}</strong></span><span className="wai-row-client">Número digitado</span></span>
      </button>}
      {shown.length > 0 && <p className="wai-new-title">Destinatários dos clientes</p>}
      {shown.map(contact => <button key={contact.id} type="button" className="wai-row" onClick={() => onPick({ phone: contact.phone.replace(/\D/g, ""), name: contact.name, clientName: contact.clientName })}>
        <span className="wai-avatar" style={{ width: 49, height: 49, background: colorFor(contact.name) }}>{initialsOf(contact.name)}</span>
        <span className="wai-row-main"><span className="wai-row-top"><strong>{contact.name}</strong></span><span className="wai-row-preview"><span>{formatWhatsAppPhone(contact.phone.replace(/\D/g, ""))}</span></span>{contact.clientName && <span className="wai-row-client">{contact.clientName}</span>}</span>
      </button>)}
      {!shown.length && !typed && <p className="wai-list-note">{contacts.length ? "Nenhum destinatário encontrado. Digite o número com DDD para conversar com outra pessoa." : "Digite o número com DDD. Os destinatários cadastrados nos clientes aparecem aqui."}</p>}
    </div>
  </div>;
}

/** Conversation that does not exist yet: the first text creates it (QR Code session). */
function DraftChat({ draft, demo, onClose, onStarted }: { draft: { phone: string; name: string | null; clientName: string | null }; demo: boolean; onClose: () => void; onStarted: (conversationId: string | null) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const title = draft.name ?? formatWhatsAppPhone(draft.phone);
  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    if (demo) { setError("Na demonstração nenhuma mensagem é enviada."); return; }
    setSending(true); setError("");
    try {
      const response = await fetch("/api/whatsapp/inbox/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: draft.phone, name: draft.name ?? undefined, text: body }) });
      const result = await response.json().catch(() => ({})) as { error?: string; conversationId?: string | null };
      if (!response.ok) { setError(result.error ?? "Não foi possível enviar agora."); return; }
      onStarted(result.conversationId ?? null);
    } catch { setError("Sem conexão. A mensagem não foi enviada."); } finally { setSending(false); }
  }
  return <>
    <header className="wai-chat-head">
      <button type="button" className="wai-icon-button wai-back" onClick={onClose} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button>
      {draft.name ? <span className="wai-avatar" style={{ width: 40, height: 40, background: colorFor(title) }}>{initialsOf(draft.name)}</span> : <span className="wai-avatar is-icon" style={{ width: 40, height: 40 }}><Contact size={20} /></span>}
      <div className="wai-chat-title"><strong>{title}</strong><small>{[draft.name ? formatWhatsAppPhone(draft.phone) : null, draft.clientName ? `Cliente: ${draft.clientName}` : null, "Nova conversa"].filter(Boolean).join(" · ")}</small></div>
    </header>
    <div className="wai-messages"><div className="wai-messages-inner"><p className="wai-day"><span>Escreva a primeira mensagem para começar a conversa</span></p></div></div>
    <footer className="wai-composer-area">
      {error && <p role="alert" className="wai-composer-error"><AlertCircle size={14} />{error}</p>}
      <div className="wai-composer">
        <textarea rows={1} autoFocus value={text} maxLength={MAX_REPLY_TEXT} placeholder="Digite uma mensagem" aria-label="Primeira mensagem" onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <button type="button" className="wai-send" onClick={() => void send()} disabled={sending || !text.trim()} aria-label="Enviar"><SendHorizontal size={20} /></button>
      </div>
    </footer>
  </>;
}
