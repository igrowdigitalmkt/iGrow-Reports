"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, BadgeCheck, Check, CheckCheck, Clock3, Contact, FileText, Image as ImageIcon, Lock, MapPin, MessageSquareText, Mic, MoreVertical, Play, Plus, QrCode, Search, SendHorizontal, Smile, Star, Sticker, UsersRound, Video, X, Headphones } from "lucide-react";
import { clockTime, colorFor, conversationTitle, dayKey, dayLabel, formatWhatsAppPhone, initialsOf, kindLabel, listTime } from "./inbox-format";
import type { InboxChannel, InboxConversation, InboxList, InboxMessageItem, InboxStatus } from "./inbox-types";
import { EmojiPicker } from "./emoji-picker";
import { ACCEPTED_REPLY_FILES, MAX_REPLY_FILE_BYTES, MAX_REPLY_TEXT, replyMediaKind, replyWindow } from "./reply-rules";
import "./inbox.css";

type Filter = "all" | "unread" | "favorites" | "groups";
const QR_CHANNEL: InboxChannel = { key: "qr", kind: "qr", name: "Seu WhatsApp", phone: null, coexistence: false };

/**
 * WhatsApp inbox in the layout of WhatsApp Desktop: numbers on the left rail, conversations,
 * and the open chat, where the team replies with text, emojis and files.
 */
export function WhatsAppInbox({ channels, demo = false, canReply = true, demoConversations = [], demoThreads = {} }: {
  channels: InboxChannel[]; demo?: boolean; canReply?: boolean; demoConversations?: InboxConversation[]; demoThreads?: Record<string, InboxMessageItem[]>;
}) {
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

  return <div className={`wai-shell${openId ? " is-chat-open" : ""}`}>
    <nav className="wai-rail" aria-label="Números de WhatsApp">
      {allChannels.map(item => {
        const unread = unreadByChannel.get(item.key) ?? 0;
        return <button key={item.key} type="button" className={`wai-rail-item${item.key === channelKey ? " is-active" : ""}`} aria-pressed={item.key === channelKey}
          title={`${item.name}${item.phone ? ` · ${item.phone}` : ""}${item.kind === "official" ? item.coexistence ? " · API com coexistência" : " · API oficial" : " · QR Code"}`}
          onClick={() => { setChannelKey(item.key); setOpenId(null); setFilter("all"); }}>
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
          <button type="button" className="wai-icon-button" disabled title="Nova conversa · em breve"><Plus size={20} /></button>
          <button type="button" className="wai-icon-button" disabled title="Mais opções · em breve"><MoreVertical size={20} /></button>
        </div>
      </header>
      <label className="wai-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar ou começar uma nova conversa" aria-label="Pesquisar conversas" /></label>
      <div className="wai-filters" role="group" aria-label="Filtrar conversas">
        {([["all", "Tudo"], ["unread", unreadHere ? `Não lidas ${unreadHere}` : "Não lidas"], ["favorites", "Favoritas"], ...(channel.kind === "qr" ? [["groups", "Grupos"]] : [])] as Array<[Filter, string]>).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "is-active" : undefined} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      <div className="wai-rows">
        {!list && <p className="wai-list-note">Carregando conversas…</p>}
        {list && !list.ready && <p className="wai-list-note">A caixa de entrada precisa da atualização do banco de dados. Assim que ela for aplicada, as conversas passam a aparecer aqui.</p>}
        {list?.ready && !visible.length && <p className="wai-list-note">{search ? "Nenhuma conversa encontrada." : filter === "all" ? "As conversas deste número aparecem aqui a partir de agora, conforme as mensagens chegam ou são enviadas." : "Nenhuma conversa neste filtro."}</p>}
        {visible.map(item => <ConversationRow key={item.id} item={item} active={item.id === openId} now={now} onOpen={() => choose(item.id)} />)}
      </div>
    </section>

    <section className="wai-chat" aria-label="Conversa">
      {!open ? <div className="wai-empty">
        <div className="wai-empty-icon"><MessageSquareText size={44} strokeWidth={1.4} /></div>
        <h3>WhatsApp na iGrow</h3>
        <p>Escolha uma conversa para ver as mensagens. As respostas dos seus clientes aos relatórios aparecem aqui, junto com o que foi enviado por cada número.</p>
        <span className="wai-empty-lock"><Lock size={13} />Visível só para a equipe com acesso ao WhatsApp</span>
      </div> : <>
        <header className="wai-chat-head">
          <button type="button" className="wai-icon-button wai-back" onClick={() => setOpenId(null)} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button>
          <Avatar item={open} size={40} />
          <div className="wai-chat-title"><strong>{conversationTitle(open)}</strong>
            <small>{[open.isGroup ? "Grupo" : open.title ? formatWhatsAppPhone(open.remoteId) : null, open.clientName ? `Cliente: ${open.clientName}` : null].filter(Boolean).join(" · ") || channel.name}</small></div>
          <div className="wai-head-actions">
            <button type="button" className={`wai-icon-button${open.favorite ? " is-on" : ""}`} onClick={() => toggleFavorite(open)} aria-pressed={open.favorite} title={open.favorite ? "Remover das favoritas" : "Favoritar"}><Star size={19} /></button>
            <button type="button" className="wai-icon-button" disabled title="Mais opções · em breve"><MoreVertical size={20} /></button>
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
                <Bubble message={message} tail={!grouped} showAuthor={open.isGroup && message.direction === "in" && !grouped} />
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

function Avatar({ item, size }: { item: InboxConversation; size: number }) {
  const title = conversationTitle(item);
  const style = { width: size, height: size };
  if (item.isGroup) return <span className="wai-avatar is-icon" style={style}><UsersRound size={size * .5} /></span>;
  if (!item.title) return <span className="wai-avatar is-icon" style={style}><Contact size={size * .5} /></span>;
  return <span className="wai-avatar" style={{ ...style, background: colorFor(title) }}>{initialsOf(title)}</span>;
}

function Ticks({ status }: { status: InboxStatus }) {
  if (status === "read") return <CheckCheck size={16} className="wai-tick is-read" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck size={16} className="wai-tick" aria-label="Entregue" />;
  if (status === "failed") return <AlertCircle size={14} className="wai-tick is-failed" aria-label="Não enviada" />;
  if (status === "pending") return <Clock3 size={13} className="wai-tick" aria-label="Enviando" />;
  return <Check size={16} className="wai-tick" aria-label="Enviada" />;
}

const KIND_ICONS: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: Mic, document: FileText, sticker: Sticker, location: MapPin, contact: Contact };

function ConversationRow({ item, active, now, onOpen }: { item: InboxConversation; active: boolean; now: Date; onOpen: () => void }) {
  const Icon = item.lastKind ? KIND_ICONS[item.lastKind] : undefined;
  const preview = item.preview || kindLabel(item.lastKind);
  return <button type="button" className={`wai-row${active ? " is-active" : ""}`} onClick={onOpen}>
    <Avatar item={item} size={49} />
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

function Bubble({ message, tail, showAuthor }: { message: InboxMessageItem; tail: boolean; showAuthor: boolean }) {
  const out = message.direction === "out";
  const meta = <span className="wai-meta">{clockTime(message.sentAt)}{out && <Ticks status={message.status} />}</span>;
  const Icon = KIND_ICONS[message.kind];
  return <div className={`wai-bubble-row ${out ? "is-out" : "is-in"}`}>
    <div className={`wai-bubble${tail ? " has-tail" : ""}${message.kind === "reaction" ? " is-reaction" : ""}`}>
      {showAuthor && message.author && <span className="wai-author" style={{ color: colorFor(message.author) }}>{message.author}</span>}
      {message.kind === "document" && <div className="wai-document">
        <span className="wai-document-icon"><FileText size={22} /><small>{(message.mediaName?.split(".").pop() ?? "PDF").slice(0, 4).toUpperCase()}</small></span>
        <span className="wai-document-name">{message.mediaName ?? "Documento"}</span>
      </div>}
      {message.kind === "audio" && <div className="wai-audio"><span className="wai-audio-play"><Play size={18} /></span><span className="wai-audio-wave" aria-hidden /><small>Áudio</small></div>}
      {Icon && message.kind !== "document" && message.kind !== "audio" && <div className="wai-media"><Icon size={18} />{kindLabel(message.kind)}{message.kind === "contact" || message.kind === "location" ? message.body ? `: ${message.body}` : "" : ""}</div>}
      {message.kind === "template" && !message.body && <div className="wai-media"><FileText size={18} />Mensagem modelo</div>}
      {message.kind === "other" && !message.body && <div className="wai-media">Mensagem não suportada nesta tela</div>}
      {message.body && message.kind !== "contact" && message.kind !== "location" && <p className="wai-text">{message.body}{meta}</p>}
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
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<"attach" | "emoji" | null>(null);
  const [sending, setSending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const reply = replyWindow(kind, conversation.lastInboundAt, now);

  function chooseFile(accept: string) {
    setMenu(null);
    if (!picker.current) return;
    picker.current.accept = accept;
    picker.current.click();
  }
  function onFile(selected: File | undefined) {
    if (!selected) return;
    if (!replyMediaKind(selected.type, kind)) { setError("Esse tipo de arquivo não é aceito pelo WhatsApp."); return; }
    if (selected.size > MAX_REPLY_FILE_BYTES) { setError("O arquivo precisa ter até 4 MB."); return; }
    setError(""); setFile(selected); field.current?.focus();
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
    const mediaKind = file ? replyMediaKind(file.type, kind) : null;
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
      <FileText size={18} /><span><strong>{file.name}</strong><small>{formatBytes(file.size)}{text ? " · o texto vai como legenda" : ""}</small></span>
      <button type="button" className="wai-icon-button" onClick={() => setFile(null)} aria-label="Remover arquivo"><X size={16} /></button>
    </div>}
    {kind === "official" && closes && <p className="wai-window">Resposta livre até {dayLabel(closes, now).toLowerCase()} às {clockTime(closes)} · respostas pela API oficial podem ser cobradas pela Meta</p>}
    <div className="wai-composer">
      <div className="wai-composer-menu">
        <button type="button" className={`wai-icon-button${menu === "attach" ? " is-on" : ""}`} onClick={() => setMenu(menu === "attach" ? null : "attach")} aria-expanded={menu === "attach"} title="Anexar"><Plus size={22} /></button>
        {menu === "attach" && <div className="wai-attach-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => chooseFile(".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv")}><FileText size={18} className="is-doc" />Documento</button>
          <button type="button" role="menuitem" onClick={() => chooseFile("image/jpeg,image/png,image/webp,video/mp4,video/3gpp")}><ImageIcon size={18} className="is-photo" />Fotos e vídeos</button>
          <button type="button" role="menuitem" onClick={() => chooseFile("audio/mpeg,audio/ogg,audio/mp4,audio/aac")}><Headphones size={18} className="is-audio" />Áudio</button>
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
        : <button type="button" className="wai-icon-button" disabled title="Gravar áudio pela iGrow ainda não está disponível"><Mic size={22} /></button>}
      <input ref={picker} type="file" hidden accept={ACCEPTED_REPLY_FILES} onChange={event => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
  </footer>;
}
