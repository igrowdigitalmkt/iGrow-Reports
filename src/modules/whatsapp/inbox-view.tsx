"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "@fontsource-variable/roboto/wght.css";
import { createPortal } from "react-dom";
import { AlertCircle, Archive, ArrowLeft, BadgeCheck, Download, Loader2, Pause, Phone, CircleDashed, Settings, Store, MessagesSquare, Check, CheckCheck, Clock3, Contact, FileText, Image as ImageIcon, Lock, MapPin, Megaphone, MessageSquareText, Mic, MoreVertical, Play, Plus, Search, SendHorizontal, Smile, Star, Sticker, Trash2, UsersRound, Video, X, Headphones, Info, CheckSquare, BookmarkCheck, ChevronDown, Reply, Copy, Forward, Pin, PinOff, ListFilter } from "lucide-react";
import { clockTime, colorFor, conversationTitle, dayKey, dayLabel, formatWhatsAppPhone, initialsOf, kindLabel, listTime, phoneKey } from "./inbox-format";
import type { InboxChannel, InboxContact, InboxConversation, InboxList, InboxMessageItem, InboxStatus } from "./inbox-types";
import { EmojiPicker } from "./emoji-picker";
import { WhatsAppText } from "./inbox-text";
import { ACCEPTED_REPLY_FILES, MAX_REPLY_FILE_BYTES, MAX_REPLY_TEXT, replyMediaKind, replyWindow } from "./reply-rules";
import { optimisticReadApplies, optimisticReadSnapshot, type OptimisticRead } from "./inbox-unread";
import { latestInboxCursor, reconcileInboxList } from "./inbox-merge";
import { canForwardInboxMessage, canDeleteOwnMessage } from "./message-actions";
import { CustomListEditor, CustomListManager, CustomListMembership, useCustomLists, type CustomList } from "./custom-lists";
import "./inbox.css";
import "./inbox-reference.css";
import "./custom-lists.css";
import "./inbox-fidelity.css";
import "./inbox-screens.css";
import "./inbox-menus-fidelity.css";
import "./inbox-rail-fidelity.css";
import "./inbox-pixel-precision.css";
import "./inbox-screenshot-corrections.css";
import "./voice-note.css";

type Filter = "all" | "unread" | "favorites" | "groups";
type StarredItem = { id: string; conversationId: string; kind: string; body: string | null; sentAt: string; title: string | null; remoteId: string; isGroup: boolean; channelKey: string };
type DetailData = { media: Array<{ id: string; kind: string; media_name: string | null; sent_at: string }>; group: { subject: string | null; description: string | null; members: number | null; participants: Array<{ id: string; admin: boolean }> } | null };
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
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMenuOpen, setBulkMenuOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ completed: 0, total: 0 });
  const [starPanel, setStarPanel] = useState(false);
  const [stars, setStars] = useState<StarredItem[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<DetailData | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [viewer, setViewer] = useState<{ displaySrc: string; downloadSrc: string } | null>(null);
  const [draft, setDraft] = useState<{ phone: string; name: string | null; clientName: string | null } | null>(null);
  // Messages being sent (or sent in the demo), shown until the conversation reloads from the server.
  const [outbox, setOutbox] = useState<Record<string, InboxMessageItem[]>>({});
  const [qrPhone, setQrPhone] = useState<string | null>(null);
  const allChannels = useMemo(() => [{ ...QR_CHANNEL, phone: qrPhone }, ...channels], [channels, qrPhone]);
  const [channelKey, setChannelKey] = useState("qr");
  const customLists = useCustomLists(channelKey, demo);
  const [customFilterId, setCustomFilterId] = useState<string | null>(null);
  const [managingLists, setManagingLists] = useState(false);
  const [editingList, setEditingList] = useState<CustomList | null | undefined>(undefined);
  const [deletingList, setDeletingList] = useState<CustomList | null>(null);
  const [list, setList] = useState<InboxList | null>(demo ? { ready: true, conversations: demoConversations } : null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ id: string; messages: InboxMessageItem[] } | null>(null);
  const [demoReady, setDemoReady] = useState(false);
  // Keep the server/client first frame identical (demo timestamps are relative
  // to when the sample is imported). Reveal it after the first browser paint.
  const [now, setNow] = useState(() => new Date(0));
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setNow(new Date());
      setDemoReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // Only suppress the badge for the message snapshot that was opened, never for future messages.
  const [readLocally, setReadLocally] = useState<Record<string, OptimisticRead>>({});
  const [actionError, setActionError] = useState("");
  const [replyTarget, setReplyTarget] = useState<InboxMessageItem | null>(null);
  const [messageInfo, setMessageInfo] = useState<InboxMessageItem | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatListsOpen, setChatListsOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [forwardIds, setForwardIds] = useState<string[]>([]);
  const [forwardTargets, setForwardTargets] = useState<string[]>([]);
  const [forwardQuery, setForwardQuery] = useState("");
  const [forwardBusy, setForwardBusy] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  async function refreshStars() {
    if (demo) return;
    const response = await fetch("/api/whatsapp/inbox/starred", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível consultar as mensagens favoritas.");
    const payload = await response.json() as { items: StarredItem[] };
    setStars(payload.items);
    setStarredIds(new Set(payload.items.map(item => item.id)));
  }

  useEffect(() => {
    if (demo) return;
    void fetch("/api/whatsapp/inbox/starred", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((body: { items?: StarredItem[] } | null) => {
        if (!body?.items) return;
        setStars(body.items); setStarredIds(new Set(body.items.map(item => item.id)));
      }).catch(() => undefined);
  }, [demo]);

  useEffect(() => {
    if (!detailsOpen || !openId) return;
    if (demo) return;
    let cancelled = false;
    void fetch(`/api/whatsapp/inbox/${openId}/details`, { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((result: DetailData | null) => { if (!cancelled) { setDetails(result); setDetailsLoading(false); } })
      .catch(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [demo, detailsOpen, openId]);

  // Recent monitoring only: deltas every 10 seconds; reconcile deletions every 10 minutes.
  // Skip inactive tabs and avoid overlapping requests so a slow poll cannot overwrite fresh data.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    let inFlight = false;
    let since: string | null = null;
    let lastFull = 0;
    const load = async (forceFull = false) => {
      if (document.hidden || inFlight || cancelled) return;
      const full = forceFull || !since || Date.now() - lastFull >= 600_000;
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
    // Refresh proven phone/LID aliases once per page load, without requiring the
    // user to disconnect their QR session or lose recent messages.
    void fetch("/api/whatsapp/qr/peers", { method: "POST" })
      .then(response => response.ok ? response.json() : null)
      .then(async (result: { merged?: number } | null) => {
        if (cancelled || !result?.merged || result.merged <= 0) return;
        // Force an authoritative snapshot: incremental polling cannot represent
        // deleted alias rows after two conversations become one.
        const response = await fetch("/api/whatsapp/inbox", { cache: "no-store" });
        if (!response.ok) return;
        const updated = await response.json() as InboxList;
        if (!cancelled && updated.ready) { setList(updated); since = latestInboxCursor(null,updated.conversations); lastFull = Date.now(); }
      }).catch(() => undefined);
    fetch("/api/whatsapp/qr", { cache: "no-store" }).then(response => response.ok ? response.json() : null)
      .then((status: { state?: string; phone?: string | null } | null) => { if (!cancelled && status?.state === "connected") setQrPhone(status.phone ?? null); }).catch(() => undefined);
    const timer = setInterval(() => void load(), 10_000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [demo]);

  // Open conversation: messages refreshed while it stays open, and marked as read.
  useEffect(() => {
    if (!openId || demo) return;
    let cancelled = false;
    const attempted = new Set<string>();
    const load = () => {
      if (document.hidden) return;
      fetch(`/api/whatsapp/inbox/${openId}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null)
        .then((body: { conversation: InboxConversation | null; messages: InboxMessageItem[] } | null) => {
          if (cancelled || !body) return;
          setThread({ id: openId, messages: body.messages });
          const item = body.conversation;
          if (!item?.unread) return;
          // Do not silently swallow a failed phone sync, retry every 8s, or
          // let a transient optimistic badge imply the phone was marked read.
          const snapshot = `${item.lastInboundAt}:${item.lastAt}:${item.unread}`;
          if (attempted.has(snapshot)) return;
          attempted.add(snapshot);
          void (async () => {
            try {
              const response = await fetch(`/api/whatsapp/inbox/${openId}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "read" }),
              });
              if (!response.ok) {
                const detail = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(detail?.error ?? "O celular não confirmou a leitura.");
              }
              if (cancelled) return;
              setActionError("");
              setList(current => current && {
                ...current,
                conversations: current.conversations.map(entry =>
                  entry.id === openId && entry.lastInboundAt === item.lastInboundAt && entry.lastAt === item.lastAt
                    ? { ...entry, unread: 0 } : entry),
              });
              setReadLocally(current => {
                const next = { ...current };
                delete next[openId];
                return next;
              });
            } catch (error) {
              if (!cancelled) setActionError(error instanceof Error ? error.message : "Não foi possível sincronizar a leitura.");
            }
          })();
        }).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [openId, demo]);

  const loaded = demo ? openId ? demoThreads[openId] ?? [] : [] : thread?.id === openId ? thread.messages : null;
  const pending = openId ? outbox[openId] ?? [] : [];
  const messages = loaded ? [...loaded, ...pending] : pending.length ? pending : null;
  // WhatsApp displays group participants beneath the title. Only use actual
  // authors found in the recent, connected conversation (never fake names).
  const recentGroupAuthors = [...new Set((messages ?? [])
    .filter(message => message.direction === "in" && message.author && !message.author.includes("@"))
    .map(message => message.author!.trim()))].filter(Boolean).slice(0, 2);
  const groupSubtitle = [
    ...recentGroupAuthors,
    ...((messages ?? []).some(message => message.direction === "out") ? ["Você"] : []),
  ].join(", ") || "Grupo";
  const searchTerms = chatSearchQuery.trim().toLocaleLowerCase("pt-BR");
  const chatSearchResults = !searchTerms ? [] : (messages ?? []).filter(message =>
    !message.revoked && (message.body ?? "").toLocaleLowerCase("pt-BR").includes(searchTerms));
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
  const visible = inChannel.filter(item => (!customFilterId
    ? (filter === "all" || (filter === "unread" && item.unread > 0) || (filter === "favorites" && item.favorite) || (filter === "groups" && item.isGroup))
    : !!customLists.lists.find(list => list.id === customFilterId)?.conversationIds.includes(item.id))
    && (!search || `${conversationTitle(item)} ${item.remoteId} ${item.clientName ?? ""} ${item.preview ?? ""}`.toLocaleLowerCase("pt-BR").includes(search)));
  const unreadHere = inChannel.filter(item => item.unread > 0).length;
  const open = conversations.find(item => item.id === openId) ?? null;
  const channel = allChannels.find(item => item.key === channelKey) ?? allChannels[0];
  const selfConversation = conversations.find(item =>
    item.channelKey === channelKey && !item.isGroup &&
    ((channel.phone && phoneKey(item.remoteId) === phoneKey(channel.phone)) ||
      /\(você\)/i.test(item.title ?? "")));

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
    setListMenuOpen(false);
    setDetailsOpen(false); setDetails(null); setChatListsOpen(false);
    setReplyTarget(null); setMessageInfo(null); setSelectedMessageIds(new Set()); setForwardIds([]); setForwardTargets([]); setDeleteIds([]); setChatSearchOpen(false); setChatSearchQuery("");
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

  async function toggleMessageStar(message: InboxMessageItem) {
    if (demo || message.id.startsWith("local-")) return;
    const value = !starredIds.has(message.id);
    setStarredIds(current => {
      const next = new Set(current);
      if (value) next.add(message.id); else next.delete(message.id);
      return next;
    });
    try {
      const response = await fetch("/api/whatsapp/inbox/starred", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, starred: value }),
      });
      if (!response.ok) throw new Error("Não foi possível salvar a mensagem favorita.");
      await refreshStars();
    } catch {
      setStarredIds(current => {
        const next = new Set(current);
        if (value) next.delete(message.id); else next.add(message.id);
        return next;
      });
      setActionError("Não foi possível atualizar o favorito. Tente novamente.");
    }
  }

  async function reactTo(message: InboxMessageItem, emoji: string) {
    if (!openId || demo || reactingId || message.id.startsWith("local-")) return;
    setReactingId(message.id);
    setActionError("");
    // Tapping the emoji already used by this account removes the reaction.
    const value = message.reactions?.some(reaction => reaction.mine && reaction.emoji === emoji) ? "" : emoji;
    try {
      const response = await fetch(`/api/whatsapp/inbox/${openId}/react`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, emoji: value }),
      });
      const body = await response.json().catch(() => null) as { error?: string; recorded?: boolean } | null;
      if (!response.ok) throw new Error(body?.error || "O WhatsApp não confirmou a reação.");
      if (body?.recorded === false) setActionError("Reação enviada, mas ainda não foi possível atualizar o histórico local.");
      reload(openId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Não foi possível reagir.");
    } finally {
      setReactingId(null);
    }
  }

  async function copyMessage(message: InboxMessageItem) {
    if (!message.body) { setActionError("Essa mensagem não possui texto para copiar."); return; }
    try { await navigator.clipboard.writeText(message.body); }
    catch { setActionError("Não foi possível copiar. Verifique a permissão do navegador."); }
  }

  function toggleSelectedMessage(id: string) {
    setSelectedMessageIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function copySelectedMessages() {
    const selected = (messages ?? []).filter(message => selectedMessageIds.has(message.id) && message.body);
    if (!selected.length) return;
    try {
      await navigator.clipboard.writeText(selected.map(item => item.body).join("\n"));
      setSelectedMessageIds(new Set());
    } catch { setActionError("Não foi possível copiar as mensagens selecionadas."); }
  }

  async function favoriteSelectedMessages() {
    const selected = (messages ?? []).filter(message => selectedMessageIds.has(message.id) && !starredIds.has(message.id));
    for (const message of selected) await toggleMessageStar(message);
    setSelectedMessageIds(new Set());
  }

  async function performLocalMessageAction(action: "pin" | "unpin" | "hide" | "revoke", ids: string[]) {
    if (!openId || !ids.length || messageActionBusy) return;
    if (demo) { setActionError("Ações de organização não são salvas na demonstração."); return; }
    const deleting = action === "hide" || action === "revoke";
    if (deleting && (messages ?? []).filter(message => ids.includes(message.id)).some(message =>
      !canDeleteOwnMessage(message) || message.id.startsWith("local-"))) {
      setActionError("Só é permitido apagar mensagens enviadas pelo seu número.");
      return;
    }
    setMessageActionBusy(true); setActionError("");
    try {
      const response = await fetch(`/api/whatsapp/inbox/${openId}/messages/actions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, messageIds: ids }),
      });
      const result = await response.json().catch(() => null) as { error?: string; completed?: number; requested?: number } | null;
      if (!response.ok) throw new Error(
        `${result?.completed ? `${result.completed} mensagem(ns) já processada(s). ` : ""}${result?.error || "Não foi possível concluir a ação."}`);
      setDeleteIds([]);
      setSelectedMessageIds(new Set());
      reload(openId);
    } catch (error) {
      if (action === "revoke") {
        // A batch may have completed partially on WhatsApp. Reconcile all
        // visible messages to prevent re-sending a revocation of the same key.
        reload(openId);
        setDeleteIds([]); setSelectedMessageIds(new Set());
      }
      setActionError(error instanceof Error ? error.message : "Falha ao atualizar a mensagem.");
    } finally { setMessageActionBusy(false); }
  }

  function startForward(ids: string[]) {
    if (!ids.length) return;
    // The demo may preview the forwarding dialog, but sending remains disabled.
    const selected = (messages ?? []).filter(item => ids.includes(item.id));
    if (selected.some(item => item.revoked || !canForwardInboxMessage(item))) {
      setActionError("Este tipo de mensagem não pode ser encaminhado pelo iGrow."); return;
    }
    if (selected.length > 10) { setActionError("Encaminhe até 10 mensagens por vez."); return; }
    setActionError("");
    setForwardIds(selected.map(item => item.id)); setForwardTargets([]); setForwardQuery("");
  }

  async function forwardMessages(targetIds: string[]) {
    if (!open || !forwardIds.length || !targetIds.length || forwardBusy || demo) return;
    if (targetIds.length > 10) { setActionError("Selecione no máximo 10 conversas por encaminhamento."); return; }
    const targets = targetIds.map(id => list?.conversations.find(item => item.id === id && item.channelKey === open.channelKey));
    if (targets.some(item => !item)) { setActionError("Escolha apenas destinatários do mesmo número conectado."); return; }
    if (channel.kind === "official" && targets.some(item => item && !replyWindow("official", item.lastInboundAt, new Date()).open)) {
      setActionError("Um dos destinatários está fora da janela de atendimento de 24 horas."); return;
    }
    const batch = (messages ?? []).filter(item => forwardIds.includes(item.id));
    let confirmed = 0;
    setForwardBusy(true); setActionError("");
    try {
      // Prepare once; send sequentially to each explicitly selected recipient.
      // This does not alter the source message or simulate server confirmations.
      const prepared: FormData[] = [];
      for (const item of batch) {
        const form = new FormData();
        if (item.body) form.append("text", item.body);
        if (["image","video","audio","document"].includes(item.kind)) {
          const response = await fetch(`/api/whatsapp/inbox/media/${item.id}`, { cache: "no-store" });
          if (!response.ok) throw new Error("Não foi possível recuperar a mídia selecionada.");
          const blob = await response.blob();
          if (!blob.size || blob.size > MAX_REPLY_FILE_BYTES ||
            !replyMediaKind(blob.type, channel.kind, item.kind === "document"))
            throw new Error("Um dos arquivos não pode ser encaminhado (formato ou limite de 4 MB).");
          form.append("file", new File([blob], item.mediaName || `arquivo-${item.id}`, { type: blob.type }));
          if (item.kind === "document") form.append("asDocument", "1");
        } else if (!item.body) throw new Error("Mensagem sem conteúdo encaminhável.");
        prepared.push(form);
      }
      const total = prepared.length * targetIds.length;
      for (const targetId of targetIds) for (const form of prepared) {
        const response = await fetch(`/api/whatsapp/inbox/${targetId}/send`, { method: "POST", body: form });
        const result = await response.json().catch(() => null) as { error?: string } | null;
        if (!response.ok) throw new Error(`${confirmed} de ${total} envios confirmados. ${result?.error || "O WhatsApp recusou o próximo envio."}`);
        confirmed++;
      }
      setForwardIds([]); setForwardTargets([]); setSelectedMessageIds(new Set());
      if (openId && targetIds.includes(openId)) reload(openId);
    } catch (error) {
      if (confirmed) { setForwardIds([]); setForwardTargets([]); setSelectedMessageIds(new Set()); }
      setActionError((error instanceof Error ? error.message : "Não foi possível encaminhar.") +
        (confirmed ? " O encaminhamento parcial foi encerrado para evitar envios duplicados. Confira as conversas antes de tentar novamente." : ""));
    } finally { setForwardBusy(false); }
  }

  async function markSelectedRead(ids: string[]) {
    if (!ids.length || bulkBusy) return;
    setListMenuOpen(false); setBulkBusy(true); setBulkProgress({ completed: 0, total: ids.length }); setActionError("");
    let done = 0;
    const failures: string[] = [];
    // At most two phone calls concurrently; an entire WhatsApp account must not
    // generate hundreds of simultaneous Baileys app-state writes.
    for (let start = 0; start < ids.length; start += 2) {
      const batch = ids.slice(start, start + 2);
      const results = await Promise.all(batch.map(async id => {
        if (demo) return true;
        try {
          const response = await fetch(`/api/whatsapp/inbox/${id}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "read" }),
          });
          return response.ok;
        } catch { return false; }
      }));
      results.forEach((ok, index) => {
        if (!ok) failures.push(batch[index]); else {
          const id = batch[index];
          setList(previous => previous && { ...previous,
            conversations: previous.conversations.map(item => item.id === id ? { ...item, unread: 0 } : item) });
          setReadLocally(current => { const next = { ...current }; delete next[id]; return next; });
        }
      });
      done += batch.length;
      setBulkProgress({ completed: done, total: ids.length });
    }
    setBulkBusy(false);
    if (failures.length) {
      setSelectedIds(failures);
      setSelecting(true);
      setActionError(`${failures.length} conversa(s) não foram confirmadas pelo WhatsApp. Elas permanecem selecionadas para tentar novamente.`);
    } else {
      setSelectedIds([]);
      setSelecting(false);
      setActionError("");
    }
    if (!demo) void fetch("/api/whatsapp/inbox", { cache: "no-store" })
      .then(r => r.ok ? r.json() : null).then((fresh: InboxList | null) => { if (fresh?.ready) setList(fresh); }).catch(() => undefined);
  }

  function toggleSelected(id: string) {
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  async function saveCustomList(name: string, color: string, conversationIds: string[]) {
    const ok = editingList
      ? await customLists.update(editingList.id, { name, color, conversationIds })
      : await customLists.create(name,color,conversationIds);
    if (ok) setEditingList(undefined);
    return ok;
  }

  async function moveCustomList(list: CustomList, direction: number) {
    const ordered = customLists.lists;
    const index = ordered.findIndex(item => item.id === list.id);
    const other = ordered[index + direction];
    if (!other) return;
    const first = await customLists.update(list.id, { sortOrder: other.sortOrder });
    if (first) await customLists.update(other.id, { sortOrder: list.sortOrder });
  }

  if (demo && !demoReady) return <div className="wai-shell wai-demo-loading" aria-busy="true"><span>Carregando demonstração de conversas…</span></div>;

  return <div className={`wai-shell${openId || draft ? " is-chat-open" : ""}`}>
    <nav className="wai-rail" aria-label="Navegação WhatsApp">
      <div className="wai-rail-top">
        <button type="button" className={`wai-rail-shortcut${!starPanel && !showArchived && !managingLists ? " is-active" : ""}`}
          title="Conversas" aria-label="Conversas"
          onClick={() => { setStarPanel(false); setShowArchived(false); setManagingLists(false); setPicking(false); setSelecting(false); setCustomFilterId(null); }}>
          <MessageSquareText size={23} />
          {!!unreadHere && <span className="wai-rail-badge">{unreadHere > 99 ? "99+" : unreadHere}</span>}
        </button>
        <button type="button" className="wai-rail-shortcut" title="Ligações: consulte pelo WhatsApp" aria-label="Ligações"
          onClick={() => setActionError("Para fazer ou consultar ligações, abra o WhatsApp. O iGrow é uma ferramenta de apoio para mensagens recentes.")}><Phone size={22}/></button>
        <button type="button" className="wai-rail-shortcut" title="Atualizações: consulte pelo WhatsApp" aria-label="Atualizações"
          onClick={() => setActionError("As atualizações de status ficam no WhatsApp e não são copiadas pelo iGrow.")}><CircleDashed size={23}/></button>
        <button type="button" className="wai-rail-shortcut" title="Canais: consulte pelo WhatsApp" aria-label="Canais"
          onClick={() => setActionError("A consulta de canais está disponível no WhatsApp original.")}><MessagesSquare size={23}/></button>
        <button type="button" className="wai-rail-shortcut" title="Comunidades: consulte pelo WhatsApp" aria-label="Comunidades"
          onClick={() => setActionError("A gestão de comunidades permanece no WhatsApp original.")}><UsersRound size={23}/></button>
        <div className="wai-rail-separator" aria-hidden="true" />
        <button type="button" className="wai-rail-shortcut" title="Ferramentas comerciais: gerencie pelo WhatsApp Business" aria-label="Ferramentas comerciais"
          onClick={() => setActionError("Ferramentas comerciais como catálogo e cobranças são gerenciadas no WhatsApp Business.")}><Store size={23}/></button>
        <button type="button" className="wai-rail-shortcut" title="Anúncios: gerencie na Meta" aria-label="Anunciar"
          onClick={() => setActionError("Anúncios são criados e gerenciados no Gerenciador de Anúncios da Meta.")}><Megaphone size={23}/></button>
      </div>
      <div className="wai-rail-bottom">
        <button type="button" className="wai-rail-shortcut" title="Mídia da conversa" aria-label="Mídias, links e documentos"
          onClick={() => { if (open) { setDetails(null); setDetailsLoading(true); setDetailsOpen(true); } else setActionError("Abra uma conversa para consultar as mídias recentes."); }}><ImageIcon size={23}/></button>
        <a className="wai-rail-exit" href={demo ? "/demo/configuracoes" : "/dashboard/configuracoes"} title="Configurações do iGrow" aria-label="Configurações do iGrow"><Settings size={24}/></a>
        <div className="wai-account-switcher">
          <button type="button" className="wai-rail-account" aria-label="Selecionar número conectado" aria-expanded={accountMenuOpen}
            title={channel.name} onClick={() => setAccountMenuOpen(value => !value)}>
            <span className="wai-account-mark">{channel.kind === "qr" ? "iGrow" : initialsOf(channel.name)}</span>
            {!!unreadHere && <span className="wai-rail-badge">{unreadHere > 99 ? "99+" : unreadHere}</span>}
          </button>
          {accountMenuOpen && <div className="wai-account-menu" role="menu">
            <strong>Contas conectadas</strong>
            {allChannels.map(item => <button key={item.key} type="button" role="menuitem" className={item.key === channelKey ? "is-active" : undefined}
              onClick={() => { setAccountMenuOpen(false); setChannelKey(item.key); setCustomFilterId(null); setManagingLists(false); setEditingList(undefined); setOpenId(null); setDraft(null); setPicking(false); setShowArchived(false); setStarPanel(false); setSelecting(false); setSelectedIds([]); setListMenuOpen(false); setDetailsOpen(false); setChatSearchOpen(false); setChatSearchQuery(""); setFilter("all"); }}>
              <span className="wai-account-mark">{item.kind === "qr" ? "iGrow" : initialsOf(item.name)}</span>
              <span>{item.name}<small>{item.phone || (item.kind === "qr" ? "QR Code" : "API oficial")}</small></span>
              {item.key === channelKey && <Check size={17}/>}
            </button>)}
            <a href={demo ? "/demo" : "/dashboard"}><ArrowLeft size={17}/>Voltar ao iGrow Reports</a>
          </div>}
        </div>
      </div>
    </nav>

    <section className="wai-list" aria-label="Conversas">
      {editingList === undefined && !managingLists && !picking && !starPanel && !showArchived && <header className="wai-list-head">
        <div><h2>WhatsApp</h2><small title="Número conectado no iGrow">{channel.name}{channel.phone ? ` · ${channel.phone}` : ""}</small></div>
        <div className="wai-head-actions">
          <button type="button" className={`wai-icon-button${picking ? " is-on" : ""}`} disabled={channel.kind !== "qr" || !canReply} onClick={() => setPicking(value => !value)}
            title={channel.kind !== "qr" ? "Nos números oficiais, uma conversa nova só começa com mensagem modelo aprovada" : "Nova conversa"}><Plus size={27} strokeWidth={2.6} /></button>
          <div className="wai-head-menu">
            <button type="button" className="wai-icon-button" aria-label="Opções de conversas" aria-expanded={listMenuOpen}
              onClick={() => setListMenuOpen(value => !value)}><MoreVertical size={20} /></button>
            {listMenuOpen && <div className="wai-attach-menu wai-chat-menu wai-list-menu" role="menu">
              <button type="button" role="menuitem" disabled title="Ferramentas comerciais precisam da integração do WhatsApp Business"><Archive size={18}/>Ferramentas comerciais</button>
              <button type="button" role="menuitem" disabled title="Criação de grupos indisponível na conexão atual"><UsersRound size={18}/>Novo grupo</button>
              <button type="button" role="menuitem" disabled title="Disponível no gerenciador da Meta"><Megaphone size={18}/>Anunciar</button>
              <button type="button" role="menuitem" disabled title="Transmissão comercial indisponível"><MessageSquareText size={18}/>Transmissão comercial</button>
              <button type="button" role="menuitem" disabled title="Catálogo administrado pelo WhatsApp Business"><FileText size={18}/>Catálogo</button>
              <button type="button" role="menuitem" disabled title="Cobranças precisam de integração de pagamentos"><BadgeCheck size={18}/>Cobranças</button>
              <button type="button" role="menuitem" disabled title="Respostas rápidas ainda não disponíveis"><SendHorizontal size={18}/>Respostas rápidas</button>
              <button type="button" role="menuitem" onClick={() => { setListMenuOpen(false); setStarPanel(true); setPicking(false); setSelecting(false); if (!demo) void refreshStars().catch(() => setActionError("Não foi possível carregar as favoritas.")); }}><BookmarkCheck size={18}/>Mensagens favoritas</button>
              <button type="button" role="menuitem" onClick={() => { setListMenuOpen(false); setSelecting(true); setStarPanel(false); setPicking(false); setShowArchived(false); }}><CheckSquare size={18}/>Selecionar conversas</button>
              <button type="button" role="menuitem" onClick={() => { setListMenuOpen(false); setManagingLists(true); setPicking(false); }}><ListFilter size={18}/>Listas</button>
              <button type="button" role="menuitem" disabled={bulkBusy || !inChannel.some(item => item.unread > 0)}
                onClick={() => void markSelectedRead(inChannel.filter(item => item.unread > 0).map(item => item.id))}><CheckCheck size={18}/>Marcar todas como lidas</button>
              <div className="wai-menu-divider"/>
              <button type="button" role="menuitem" disabled title="Bloqueio do aplicativo não está disponível"><Lock size={18}/>Bloqueio do app</button>
              <button type="button" role="menuitem" disabled title="Gerencie a conexão pela página de Integrações"><ArrowLeft size={18}/>Desconectar</button>
            </div>}
          </div>
        </div>
      </header>}
      {actionError && <p role="alert" className="wai-list-note">{actionError}</p>}
      {customLists.error && <div className="wai-custom-list-error" role="alert"><span>{customLists.error}</span><button type="button" onClick={customLists.clearError} aria-label="Fechar aviso"><X size={16} /></button></div>}
      {selecting && !picking && !starPanel && <div className="wai-selection-bar" role="toolbar" aria-label="Selecionar conversas">
        <button type="button" className="wai-selection-exit" disabled={bulkBusy} onClick={() => { setSelecting(false); setSelectedIds([]); setBulkMenuOpen(false); }} aria-label="Cancelar seleção"><X size={21} /></button>
        <span>{bulkBusy ? `Sincronizando ${bulkProgress.completed}/${bulkProgress.total}` : `Selecionadas: ${selectedIds.length}`}</span>
        <div className="wai-head-menu">
          <button type="button" className="wai-icon-button" aria-label="Opções das conversas selecionadas" aria-expanded={bulkMenuOpen}
            onClick={() => setBulkMenuOpen(value => !value)}><MoreVertical size={20}/></button>
          {bulkMenuOpen && <div className="wai-attach-menu wai-chat-menu wai-bulk-menu" role="menu">
            <button type="button" role="menuitem" disabled={bulkBusy || !selectedIds.length}
              onClick={() => { setBulkMenuOpen(false); void markSelectedRead(selectedIds); }}><CheckCheck size={19}/>Marcar como lidas</button>
            <button type="button" role="menuitem" disabled title="Silenciar precisa de suporte confirmado da conexão"><Mic size={19}/>Silenciar notificações</button>
            <button type="button" role="menuitem" disabled title="Operação em lote ainda indisponível"><Archive size={19}/>Arquivar conversas</button>
            <div className="wai-menu-divider"/>
            <button type="button" role="menuitem" disabled title="O WhatsApp não confirmou exclusão em lote"><Trash2 size={19}/>Limpar conversas selecionadas</button>
          </div>}
        </div>
      </div>}
      {editingList !== undefined ? <CustomListEditor key={editingList?.id ?? "new-list"} list={editingList}
        conversations={conversations.filter(item => item.channelKey === channelKey)} busy={customLists.busy || demo} error={customLists.error}
        onClose={() => setEditingList(undefined)} onSave={saveCustomList} />
      : managingLists ? <CustomListManager lists={customLists.lists} busy={customLists.busy}
        onBack={() => setManagingLists(false)} onCreate={() => setEditingList(null)}
        onEdit={setEditingList} onRemove={setDeletingList} onMove={(item,delta) => void moveCustomList(item,delta)} />
      : picking ? <NewChat contacts={contacts} conversations={conversations.filter(item => item.channelKey === "qr" && !item.isGroup)} onExisting={choose} onPick={startWith} onClose={() => setPicking(false)} /> : starPanel ? <div className="wai-new">
        <div className="wai-new-head"><button type="button" className="wai-icon-button" onClick={() => setStarPanel(false)} aria-label="Voltar"><ArrowLeft size={20} /></button><strong>Mensagens favoritas</strong></div>
        <p className="wai-new-note">Favoritos privados nesta plataforma, preservados enquanto as mensagens estiverem disponíveis no iGrow.</p>
        <div className="wai-rows">
          {!stars.length && <p className="wai-list-note">Nenhuma mensagem favorita.</p>}
          {stars.map(item => <button type="button" key={item.id} className="wai-starred-item" onClick={() => { setStarPanel(false); setChannelKey(item.channelKey); choose(item.conversationId); }}>
            <Star size={16} fill="currentColor" /><span><strong>{conversationTitle({ title: item.title, remoteId: item.remoteId, isGroup: item.isGroup })}</strong><small>{item.body?.slice(0, 130) || kindLabel(item.kind) || "Mensagem"} · {listTime(item.sentAt, now)}</small></span>
          </button>)}
        </div>
      </div> : showArchived ? <>
      <div className="wai-new-head"><button type="button" className="wai-icon-button" onClick={() => setShowArchived(false)} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button><strong>Arquivadas</strong></div>
      <p className="wai-new-note">As conversas arquivadas no celular também aparecem aqui após a sincronização do WhatsApp. Alterações podem levar alguns instantes para atualizar.</p>
      <div className="wai-rows">
        {!inChannel.length && <p className="wai-list-note">Nenhuma conversa arquivada.</p>}
        {inChannel.map(item => <ConversationChoice key={item.id} item={item} active={item.id === openId} now={now} photo={!demo} selecting={selecting}
          selected={selectedIds.includes(item.id)} labels={customLists.lists.filter(list => list.conversationIds.includes(item.id))}
          onOpen={() => selecting ? toggleSelected(item.id) : choose(item.id)} onSelect={() => toggleSelected(item.id)} />)}
      </div>
      </> : <>
      {!selecting && <label className="wai-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar ou começar uma nova conversa" aria-label="Pesquisar conversas" /></label>}
      {!selecting && <div className="wai-filters" role="group" aria-label="Filtrar conversas">
        {([["all", "Tudo"], ["unread", unreadHere ? `Não lidas ${unreadHere}` : "Não lidas"], ["favorites", "Favoritas"], ...(channel.kind === "qr" ? [["groups", "Grupos"]] : [])] as Array<[Filter, string]>).map(([key, label]) =>
          <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? "is-active" : undefined} onClick={() => { setFilter(key); setCustomFilterId(null); }}>{label}</button>)}
        {customFilterId && customLists.lists.filter(list => list.id === customFilterId).map(list =>
          <button type="button" key={list.id} className="is-active" onClick={() => setCustomFilterId(null)}>
            <span className="wai-list-dot" style={{ background: list.color }} />{list.name}</button>)}
        <div className="wai-filter-dropdown-anchor">
          <button type="button" className="wai-list-add-filter" aria-expanded={filterMenuOpen}
            onClick={() => setFilterMenuOpen(value => !value)} title="Outras listas e nova lista">
            <ChevronDown size={17} />
          </button>
          {filterMenuOpen && <div className="wai-filter-dropdown" role="menu">
            {customLists.lists.map(list => <button key={list.id} type="button" role="menuitem" onClick={() => {
              setFilterMenuOpen(false); setCustomFilterId(list.id); setFilter("all");
            }}><span className="wai-list-dot" style={{ background: list.color }} />{list.name}</button>)}
            <div className="wai-filter-dropdown-divider" />
            <button type="button" role="menuitem" onClick={() => { setFilterMenuOpen(false); setEditingList(null); }}><Plus size={17} />Nova lista</button>
            <button type="button" role="menuitem" onClick={() => { setFilterMenuOpen(false); setManagingLists(true); }}><ListFilter size={17} />Gerenciar listas</button>
          </div>}
        </div>
      </div>}
      <div className="wai-rows">
        {archivedHere.length > 0 && <button type="button" className="wai-archived-row" onClick={() => { setShowArchived(true); setFilter("all"); }}>
          <Archive size={20} /><span>Arquivadas</span>{archivedHere.some(item => item.unread) && <small>{archivedHere.filter(item => item.unread).length}</small>}
        </button>}
        {!list && <p className="wai-list-note">Carregando conversas…</p>}
        {list && !list.ready && <p className="wai-list-note">A caixa de entrada precisa da atualização do banco de dados. Assim que ela for aplicada, as conversas passam a aparecer aqui.</p>}
        {list?.ready && !visible.length && <p className="wai-list-note">{search ? "Nenhuma conversa encontrada." : customFilterId ? "Nenhuma conversa nesta lista." : filter === "all" ? "As conversas deste número aparecem aqui a partir de agora, conforme as mensagens chegam ou são enviadas." : "Nenhuma conversa neste filtro."}</p>}
        {visible.map(item => <ConversationChoice key={item.id} item={item} active={item.id === openId} now={now} photo={!demo} selecting={selecting}
          selected={selectedIds.includes(item.id)} labels={customLists.lists.filter(list => list.conversationIds.includes(item.id))}
          onOpen={() => selecting ? toggleSelected(item.id) : choose(item.id)} onSelect={() => toggleSelected(item.id)} />)}
      </div>
      </>}
    </section>

    {viewer && <PhotoViewer src={viewer.displaySrc} downloadSrc={viewer.downloadSrc} onClose={() => setViewer(null)} />}
    <section className={`wai-chat${draft ? " has-draft" : ""}${selectedMessageIds.size ? " is-selecting-messages" : ""}`} aria-label="Conversa">
      {draft && !open ? <DraftChat key={draft.phone} draft={draft} demo={demo} onClose={() => setDraft(null)} onStarted={started} /> : !open ? <div className="wai-empty">
        <div className="wai-empty-icon"><MessageSquareText size={44} strokeWidth={1.4} /></div>
        <h3>WhatsApp na iGrow</h3>
        <p>Escolha uma conversa para ver as mensagens. As respostas dos seus clientes aos relatórios aparecem aqui, junto com o que foi enviado por cada número.</p>
        <span className="wai-empty-lock"><Lock size={13} />Visível só para a equipe com acesso ao WhatsApp</span>
      </div> : <>
        <header className="wai-chat-head">
          <button type="button" className="wai-icon-button wai-back" onClick={() => { setOpenId(null); setDetailsOpen(false); }} aria-label="Voltar para as conversas"><ArrowLeft size={20} /></button>
          <button type="button" className="wai-contact-trigger" title={open.isGroup ? "Informações do grupo" : "Dados do contato"}
            onClick={() => { setDetails(null); setDetailsLoading(true); setDetailsOpen(true); }}>
            <Avatar key={open.id} item={open} size={40} photo={!demo} />
            <span className={`wai-chat-title${open.isGroup ? " is-group" : ""}`}><strong>{conversationTitle(open)}</strong>
              <small>{open.isGroup ? groupSubtitle : open.title ? formatWhatsAppPhone(open.remoteId) : channel.name}</small></span>
          </button>
          <div className="wai-head-actions">
            <div className="wai-chat-lists">
              <button type="button" className="wai-chat-lists-trigger" aria-label="Adicionar conversa à lista"
                aria-expanded={chatListsOpen} onClick={() => setChatListsOpen(value => !value)}>
                {customLists.lists.some(item => item.conversationIds.includes(open.id))
                  ? <span className="wai-chat-list-colors">{customLists.lists.filter(item => item.conversationIds.includes(open.id)).slice(0,2)
                    .map(item => <span key={item.id} style={{ backgroundColor: item.color }} />)}</span>
                  : <Contact size={18} />}
                <span>{customLists.lists.filter(item => item.conversationIds.includes(open.id)).length
                  ? `${customLists.lists.filter(item => item.conversationIds.includes(open.id)).length} selecionadas`
                  : "Adicionar à lista"}</span><ChevronDown size={16} />
              </button>
              {chatListsOpen && <div className="wai-chat-lists-popover">
                <strong>Adicionar à lista</strong>
                <CustomListMembership lists={customLists.lists} conversationId={open.id} busy={customLists.busy || demo}
                  onToggle={(list,member) => void customLists.setMember(list.id,open.id,member)} />
                {customLists.error && <p className="wai-list-membership-empty" role="alert">{customLists.error}</p>}
                <button type="button" className="wai-chat-lists-new" onClick={() => { setChatListsOpen(false); setEditingList(null); }}><Plus size={16} />Criar nova lista</button>
              </div>}
            </div>
            <button type="button" className="wai-icon-button wai-call-action" aria-label="Chamada de vídeo" title="As chamadas são realizadas no WhatsApp"
              onClick={() => setActionError("Chamadas de vídeo devem ser iniciadas no WhatsApp. Esta tela é uma ferramenta de apoio e não faz ligações.")}><Video size={23}/></button>
            <button type="button" className="wai-icon-button wai-call-action" aria-label="Chamada de voz" title="As chamadas são realizadas no WhatsApp"
              onClick={() => setActionError("Chamadas de voz devem ser iniciadas no WhatsApp. Esta tela é uma ferramenta de apoio e não faz ligações.")}><Phone size={23}/></button>
            <button type="button" className="wai-icon-button" aria-label="Pesquisar na conversa" title="Pesquisar na conversa"
              aria-expanded={chatSearchOpen} onClick={() => { setChatSearchOpen(value => !value); setChatSearchQuery(""); }}>
              <Search size={24} />
            </button>
            <div className="wai-head-menu">
              <button type="button" className={`wai-icon-button${menuOpen ? " is-on" : ""}`} onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-label="Mais opções"><MoreVertical size={20} /></button>
              {menuOpen && <div className="wai-attach-menu wai-chat-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDetails(null); setDetailsLoading(true); setDetailsOpen(true); }}><Info size={18} />{open.isGroup ? "Informações do grupo" : "Dados do contato"}</button>
                <button type="button" role="menuitem" onClick={() => toggleArchived(open)}><Archive size={18} />{open.archived ? "Desarquivar conversa" : "Arquivar conversa"}</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); toggleFavorite(open); }}><Star size={18} />{open.favorite ? "Remover das favoritas" : "Adicionar às favoritas"}</button>
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDetails(null); setDetailsLoading(true); setDetailsOpen(true); }}><ListFilter size={18} />Adicionar à lista</button>
              </div>}
            </div>
          </div>
        </header>
        {actionError && !forwardIds.length && !deleteIds.length && <div className="wai-chat-action-error" role="alert">
          <AlertCircle size={16} /><span>{actionError}</span>
          <button type="button" onClick={() => setActionError("")} aria-label="Fechar aviso"><X size={17} /></button>
        </div>}
        {!!messages?.some(message => message.pinned) && !selectedMessageIds.size && <div className="wai-pinned-banner" aria-label="Mensagens fixadas no iGrow">
          <Pin size={16} />
          <span><strong>Fixadas no iGrow</strong><small>{messages.filter(item => item.pinned).map(item => item.body?.slice(0, 35) || kindLabel(item.kind)).join(" · ")}</small></span>
          {messages.filter(item => item.pinned).slice(0, 3).map(item =>
            <button key={item.id} type="button" title={item.body?.slice(0, 45) || kindLabel(item.kind)}
              onClick={() => document.getElementById(`wai-msg-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
              {clockTime(item.sentAt)}
            </button>)}
        </div>}
        <div className="wai-messages">
          <div className="wai-messages-inner">
            {messages === null && <p className="wai-day"><span>Carregando…</span></p>}
            {messages?.map((message, index) => {
              const previous = messages[index - 1];
              const newDay = !previous || dayKey(previous.sentAt) !== dayKey(message.sentAt);
              const grouped = !newDay && previous?.direction === message.direction && previous.author === message.author;
              return <Fragment key={message.id}>
                {newDay && <p className="wai-day"><span>{dayLabel(message.sentAt, now)}</span></p>}
                <Bubble message={message} tail={!grouped} showAuthor={open.isGroup && message.direction === "in" && !grouped}
                  voiceAvatarSrc={channel.kind === "qr" && (message.direction === "in" || selfConversation)
                    ? `/api/whatsapp/inbox/avatar/${message.direction === "in" ? open.id : selfConversation?.id}`
                    : undefined}
                  live={!demo && !message.id.startsWith("local-")} canReact={canReply && reactingId === null} reactionBusy={reactingId === message.id}
                  selected={selectedMessageIds.has(message.id)} selectMode={selectedMessageIds.size > 0}
                  starred={starredIds.has(message.id)}
                  onReply={() => { setReplyTarget(message); setSelectedMessageIds(new Set()); }}
                  onReact={emoji => void reactTo(message, emoji)}
                  onCopy={() => void copyMessage(message)}
                  onInfo={() => setMessageInfo(message)}
                  onSelect={() => toggleSelectedMessage(message.id)}
                  onStar={() => void toggleMessageStar(message)}
                  onForward={() => startForward([message.id])}
                  onPin={() => void performLocalMessageAction(message.pinned ? "unpin" : "pin", [message.id])}
                  onDelete={() => {
                    if (!canDeleteOwnMessage(message) || message.id.startsWith("local-")) return;
                    setActionError(""); setDeleteIds([message.id]);
                  }}
                  onView={(displaySrc, downloadSrc) => setViewer({ displaySrc, downloadSrc })} />
              </Fragment>;
            })}
            <div ref={bottom} />
          </div>
        </div>
        {!!selectedMessageIds.size ? <div className="wai-message-selection-bar" role="toolbar" aria-label="Mensagens selecionadas">
          <button type="button" onClick={() => setSelectedMessageIds(new Set())} aria-label="Cancelar seleção"><X size={21} /></button>
          <span>{selectedMessageIds.size} {selectedMessageIds.size === 1 ? "selecionada" : "selecionadas"}</span>
          <button type="button" onClick={() => void copySelectedMessages()} aria-label="Copiar mensagens" title="Copiar"><Copy size={20} /></button>
          <button type="button" onClick={() => void favoriteSelectedMessages()} aria-label="Favoritar mensagens" title="Favoritar"><Star size={20} /></button>
          <button type="button" onClick={() => startForward([...selectedMessageIds])} aria-label="Encaminhar mensagens" title="Encaminhar"><Forward size={20} /></button>
          <button type="button" disabled={messageActionBusy} onClick={() => void performLocalMessageAction("pin", [...selectedMessageIds])} aria-label="Fixar mensagens" title="Fixar no iGrow"><Pin size={20} /></button>
          <button type="button" disabled={!(messages ?? []).filter(message => selectedMessageIds.has(message.id)).every(message =>
            canDeleteOwnMessage(message) && !message.id.startsWith("local-"))}
            onClick={() => { setActionError(""); setDeleteIds([...selectedMessageIds]); }}
            aria-label="Apagar mensagens" title="Só mensagens enviadas podem ser apagadas"><Trash2 size={20} /></button>
        </div> : <Composer key={open.id} conversation={open} kind={channel.kind} now={now} demo={demo} canReply={canReply}
          replyTarget={replyTarget} onClearReply={() => setReplyTarget(null)}
          onQueued={item => queue(open.id, item)} onSettled={(itemId, status) => settle(open.id, itemId, status)} onSent={() => { setReplyTarget(null); if (!demo) reload(open.id); }} />}
        {!!deleteIds.length && <div className="wai-message-info-backdrop" role="presentation" onClick={() => setDeleteIds([])}>
          <section className="wai-message-info wai-delete-dialog" role="dialog" aria-modal="true" aria-label="Apagar mensagens" onClick={event => event.stopPropagation()}>
            <header><strong>{deleteIds.length === 1 ? "Deseja apagar a mensagem?" : `Deseja apagar ${deleteIds.length} mensagens?`}</strong></header>
            {actionError && <p role="alert" className="wai-composer-error"><AlertCircle size={15} />{actionError}</p>}
            <div className="wai-delete-choices">
              {(messages ?? []).filter(message => deleteIds.includes(message.id)).every(message => message.canRevokeForEveryone) &&
                deleteIds.length <= 10 && <button type="button" className="is-danger" disabled={messageActionBusy}
                  title="Solicita exclusão no WhatsApp; só confirma se a integração aceitar." onClick={() => void performLocalMessageAction("revoke", deleteIds)}>
                  <span><strong>Apagar para todos</strong></span>
                </button>}
              <button type="button" disabled={messageActionBusy} title="Remove apenas do iGrow; não apaga no WhatsApp."
                onClick={() => void performLocalMessageAction("hide", deleteIds)}><span><strong>Apagar para mim</strong></span></button>
            </div>
            <p className="wai-delete-local-note">“Apagar para mim” remove apenas desta plataforma.</p>
            {(messages ?? []).filter(message => deleteIds.includes(message.id)).some(message => !message.canRevokeForEveryone) &&
              <p className="wai-delete-note">“Apagar para todos” só é oferecido no QR Code para mensagens com ID válido enviadas há menos de dois dias. A API oficial não permite essa operação.</p>}
            <div className="wai-confirm-actions"><button type="button" onClick={() => setDeleteIds([])}>Cancelar</button></div>
          </section>
        </div>}
        {!!forwardIds.length && <div className="wai-message-info-backdrop wai-forward-backdrop" role="presentation" onClick={() => { if (!forwardBusy) { setForwardIds([]); setForwardTargets([]); } }}>
          <section className="wai-message-info wai-forward-dialog" role="dialog" aria-modal="true" aria-label="Encaminhar mensagens para"
            onClick={event => event.stopPropagation()}>
            <header><button type="button" className="wai-icon-button" disabled={forwardBusy} onClick={() => { setForwardIds([]); setForwardTargets([]); }} aria-label="Fechar"><X size={22} /></button>
              <strong>Encaminhar mensagens para</strong></header>
            <label className="wai-forward-search"><Search size={20} /><input autoFocus value={forwardQuery} onChange={event => setForwardQuery(event.target.value)}
              placeholder="Pesquisar nome, número ou @nomedeusuário" aria-label="Buscar destinatário" /></label>
            <div className="wai-forward-destinations">
              <h4>Conversas recentes</h4>
              {(list?.conversations ?? []).filter(item => item.channelKey === open.channelKey &&
                (!forwardQuery || `${conversationTitle(item)} ${item.remoteId} ${item.clientName ?? ""}`.toLocaleLowerCase("pt-BR").includes(forwardQuery.toLocaleLowerCase("pt-BR"))))
                .slice(0, 80).map(item =>
                  <label className="wai-forward-choice" key={item.id}>
                    <input type="checkbox" disabled={forwardBusy} checked={forwardTargets.includes(item.id)}
                      onChange={() => setForwardTargets(previous => previous.includes(item.id)
                        ? previous.filter(value => value !== item.id) : previous.length < 10 ? [...previous,item.id] : previous)} />
                    <Avatar item={item} size={58} photo={!demo} />
                    <span><strong>{conversationTitle(item)}</strong><small>{item.isGroup ? "Grupo" : formatWhatsAppPhone(item.remoteId)}</small></span>
                  </label>)}
            </div>
            {actionError && <p role="alert" className="wai-composer-error"><AlertCircle size={15} />{actionError}</p>}
            {forwardBusy && <p className="wai-forward-status" role="status">Enviando mensagens. Aguarde a confirmação do WhatsApp…</p>}
            <button type="button" className="wai-forward-confirm" aria-label="Encaminhar para as conversas selecionadas"
              title={demo ? "A demonstração não envia mensagens" : "Encaminhar para as conversas selecionadas"}
              disabled={!forwardTargets.length || forwardBusy || demo} onClick={() => void forwardMessages(forwardTargets)}>
              {forwardBusy ? <Loader2 size={23} className="wai-spin" /> : <Check size={25} />}
            </button>
          </section>
        </div>}
        {messageInfo && <div className="wai-message-info-backdrop" role="presentation" onClick={() => setMessageInfo(null)}>
          <section className="wai-message-info" role="dialog" aria-modal="true" aria-label="Dados da mensagem" onClick={event => event.stopPropagation()}>
            <header><strong>Dados da mensagem</strong><button type="button" className="wai-icon-button" onClick={() => setMessageInfo(null)} aria-label="Fechar"><X size={20} /></button></header>
            <p><strong>Data:</strong> {new Date(messageInfo.sentAt).toLocaleString("pt-BR")}</p>
            <p><strong>Direção:</strong> {messageInfo.direction === "out" ? "Enviada por este número" : "Recebida"}</p>
            {messageInfo.direction === "out" && <p><strong>Entrega:</strong> {messageInfo.status === "read" ? "Lida" : messageInfo.status === "delivered" ? "Entregue" : messageInfo.status === "failed" ? "Falha" : "Enviada"}</p>}
            <p><strong>Formato:</strong> {kindLabel(messageInfo.kind) || "Texto"}</p>
            <p><strong>Reações:</strong> {messageInfo.reactions?.map(item => `${item.emoji} × ${item.count}`).join(" · ") || "Nenhuma"}</p>
          </section>
        </div>}
        {chatSearchOpen && <aside className="wai-chat-search-panel" aria-label="Pesquisar mensagens">
          <div className="wai-chat-search-head">
            <button type="button" className="wai-icon-button" aria-label="Fechar pesquisa" onClick={() => { setChatSearchOpen(false); setChatSearchQuery(""); }}><X size={20} /></button>
            <strong>Pesquisar mensagens</strong>
          </div>
          <label className="wai-search"><Search size={19} /><input autoFocus value={chatSearchQuery}
            onChange={event => setChatSearchQuery(event.target.value)} placeholder="Pesquisar nesta conversa"
            aria-label="Pesquisar nesta conversa" /></label>
          <div className="wai-chat-search-results" role="list">
            {!searchTerms && <p>Pesquise mensagens nesta conversa.</p>}
            {!!searchTerms && !chatSearchResults.length && <p>Nenhuma mensagem encontrada.</p>}
            {!!chatSearchResults.length && <small className="wai-chat-search-count">{chatSearchResults.length} {chatSearchResults.length === 1 ? "resultado" : "resultados"} nas últimas mensagens</small>}
            {chatSearchResults.map(message => <button key={message.id} type="button" role="listitem"
              onClick={() => document.getElementById(`wai-msg-${message.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>
              <span><strong>{message.direction === "out" ? "Você" : conversationTitle(open)}</strong>
                <small>{new Date(message.sentAt).toLocaleDateString("pt-BR")} · {clockTime(message.sentAt)}</small></span>
              <span className="wai-chat-search-snippet">{message.body}</span>
            </button>)}
          </div>
        </aside>}
        {detailsOpen && <ContactDetails item={open} data={details} loading={detailsLoading} demo={demo}
          lists={customLists.lists} listsBusy={customLists.busy}
          onToggleList={(list,member) => void customLists.setMember(list.id,open.id,member)}
          onClose={() => setDetailsOpen(false)} />}
      </>}
    </section>
    {deletingList && <div className="wai-list-dialog-backdrop" role="presentation" onClick={() => setDeletingList(null)}>
      <section className="wai-list-delete-dialog" role="dialog" aria-modal="true" aria-label="Apagar lista" onClick={event => event.stopPropagation()}>
        <strong>Apagar lista “{deletingList.name}”?</strong><p>As conversas não serão apagadas. Apenas esta lista personalizada será removida.</p>
        {customLists.error && <p role="alert" className="wai-list-editor-error">{customLists.error}</p>}
        <footer><button type="button" disabled={customLists.busy} onClick={() => setDeletingList(null)}>Cancelar</button>
          <button type="button" className="is-danger" disabled={customLists.busy} onClick={() => void customLists.remove(deletingList.id).then(ok => {
            if (ok) { setDeletingList(null); if (customFilterId === deletingList.id) setCustomFilterId(null); }
          })}>Apagar lista</button></footer>
      </section>
    </div>}
  </div>;
}

// Profile photo from WhatsApp (QR Code session only) over the initials, which stay if there is none.
function Avatar({ item, size, photo }: { item: InboxConversation; size: number; photo: boolean }) {
  const [failed, setFailed] = useState(false);
  const title = conversationTitle(item);
  const style = { width: size, height: size };
  const fallback = item.isGroup ? <UsersRound size={size * .5} /> : !item.title ? <Contact size={size * .5} /> : initialsOf(title);
  return <span className={`wai-avatar${item.isGroup || !item.title ? " is-icon" : ""}${item.isGroup ? " is-group" : ""}`} style={item.isGroup || !item.title ? style : { ...style, background: colorFor(title) }}>
    {fallback}
    {photo && item.channelKey === "qr" && !failed && /* eslint-disable-next-line @next/next/no-img-element -- private photo streamed from WhatsApp */
      <img src={`/api/whatsapp/inbox/avatar/${item.id}`} alt="" loading="lazy" onError={() => setFailed(true)} />}
  </span>;
}

/** Rounded sticker/smiley glyph from the current Web composer reference. */
function EmojiStickerIcon() {
  return <svg className="wai-emoji-sticker-icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8.2 2.5h7.6c3.7 0 5.7 2.1 5.7 5.8v5.3c0 1.5-.5 2.9-1.4 4L16 21.5H8.2c-3.7 0-5.7-2-5.7-5.7V8.3c0-3.7 2-5.8 5.7-5.8Z" />
    <path d="M15.9 21.4v-3.8c0-1.6.9-2.6 2.6-2.6h2.8" />
    <circle cx="9.1" cy="9.8" r=".8" fill="currentColor" stroke="none" />
    <circle cx="15.2" cy="9.8" r=".8" fill="currentColor" stroke="none" />
    <path d="M8.6 13.5c1.5 2.1 4.7 2.1 6.3 0" />
  </svg>;
}

function Ticks({ status }: { status: InboxStatus }) {
  if (status === "read") return <CheckCheck size={16} className="wai-tick is-read" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck size={16} className="wai-tick" aria-label="Entregue" />;
  if (status === "failed") return <AlertCircle size={14} className="wai-tick is-failed" aria-label="Não enviada" />;
  if (status === "pending") return <Clock3 size={13} className="wai-tick" aria-label="Enviando" />;
  return <Check size={16} className="wai-tick" aria-label="Enviada" />;
}

const KIND_ICONS: Record<string, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: Mic, document: FileText, sticker: Sticker, location: MapPin, contact: Contact };

function ConversationChoice({ item, active, now, photo, selecting, selected, labels = [], onOpen, onSelect }: {
  item: InboxConversation; active: boolean; now: Date; photo: boolean; selecting: boolean; selected: boolean; labels?: CustomList[];
  onOpen: () => void; onSelect: () => void;
}) {
  return <div className={`wai-select-row${selected ? " is-selected" : ""}`}>
    {selecting && <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Selecionar ${conversationTitle(item)}`} />}
    <ConversationRow item={item} active={active} now={now} photo={photo} labels={labels} onOpen={onOpen} />
  </div>;
}

function ConversationRow({ item, active, now, photo, labels, onOpen }: { item: InboxConversation; active: boolean; now: Date; photo: boolean; labels: CustomList[]; onOpen: () => void }) {
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
      {!!labels.length && <span className="wai-row-list-labels" aria-label={labels.map(item => item.name).join(", ")}>
        {labels.slice(0,4).map(label => <span className="wai-row-list-chip" key={label.id} title={label.name}
          style={{ "--wai-chip-color": label.color } as React.CSSProperties}>{label.name}</span>)}
        {labels.length > 4 && <small>+{labels.length - 4}</small>}
      </span>}
    </span>
  </button>;
}

// Photos and stickers are fetched ONLY after an explicit click. No background downloads.
const MEDIA_PREVIEW_MS = 2 * 60_000;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;

async function loadTemporaryMedia(src: string, signal: AbortSignal) {
  const response = await fetch(src, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Arquivo indisponível.");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_PREVIEW_BYTES) throw new Error("Arquivo grande demais para visualizar.");
  const blob = await response.blob();
  if (blob.size > MAX_PREVIEW_BYTES) throw new Error("Arquivo grande demais para visualizar.");
  return URL.createObjectURL(blob);
}

function MediaImage({ src, sticker, onView }: { src: string; sticker: boolean; onView: (displaySrc: string, downloadSrc: string) => void }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const imageUrl = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => {
    request.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
  }, []);
  async function open() {
    if (state === "loading") return;
    if (imageUrl.current) { onView(imageUrl.current, src); return; }
    setState("loading");
    const controller = new AbortController();
    request.current = controller;
    try {
      const url = await loadTemporaryMedia(src, controller.signal);
      if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
      imageUrl.current = url;
      timer.current = setTimeout(() => {
        if (imageUrl.current === url) {
          URL.revokeObjectURL(url);
          imageUrl.current = null;
        }
      }, MEDIA_PREVIEW_MS);
      setState("idle");
      onView(url, src);
    } catch { if (!controller.signal.aborted) setState("error"); }
  }
  return <button type="button" className="wai-media-on-demand" disabled={state === "loading"} onClick={() => void open()}>
    {state === "loading" ? <Loader2 size={19} className="wai-spin" /> : <ImageIcon size={19} />}
    {state === "loading" ? "Carregando…" : state === "error" ? "Tentar carregar novamente" : sticker ? "Visualizar figurinha" : "Visualizar foto"}
  </button>;
}

function DeferredVideo({ src }: { src: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const current = useRef<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    request.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    if (current.current) URL.revokeObjectURL(current.current);
  }, []);
  async function open() {
    if (state === "loading") return;
    const controller = new AbortController();
    request.current = controller;
    setState("loading");
    try {
      const url = await loadTemporaryMedia(src, controller.signal);
      if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
      current.current = url;
      setPreview(url);
      timer.current = setTimeout(() => {
        if (current.current === url) {
          URL.revokeObjectURL(url);
          current.current = null;
          setPreview(null);
          setState("idle");
        }
      }, MEDIA_PREVIEW_MS);
      setState("idle");
    } catch { if (!controller.signal.aborted) setState("error"); }
  }
  return <div>
    {preview ? <video className="wai-video" controls preload="none" src={preview} />
      : <button type="button" className="wai-media-on-demand" onClick={() => void open()} disabled={state === "loading"}>
        {state === "loading" ? <Loader2 size={18} className="wai-spin" /> : <Video size={18} />}
        {state === "loading" ? "Carregando…" : state === "error" ? "Tentar carregar vídeo" : "Visualizar vídeo"}
      </button>}
    <a className="wai-media-save" href={`${src}?baixar`}>Baixar vídeo</a>
  </div>;
}

/** Full-screen photo, as WhatsApp opens it: close with the X, Esc or a click outside; download keeps the original. */
function PhotoViewer({ src, downloadSrc, onClose }: { src: string; downloadSrc: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="wai-viewer" role="dialog" aria-modal="true" aria-label="Foto" onClick={onClose}>
    <div className="wai-viewer-bar" onClick={event => event.stopPropagation()}>
      <a className="wai-icon-button" href={`${downloadSrc}?baixar`} aria-label="Baixar foto" title="Baixar"><Download size={20} /></a>
      <button type="button" className="wai-icon-button" onClick={onClose} aria-label="Fechar" title="Fechar"><X size={22} /></button>
    </div>
    {/* eslint-disable-next-line @next/next/no-img-element -- private file streamed from WhatsApp */}
    <img src={src} alt="Foto" onClick={event => event.stopPropagation()} />
  </div>;
}

/** A voice note keeps real playback and timing; its waveform is a decorative
 * visual guide until the encrypted media is fetched. Never invent duration. */
const VOICE_WAVE_BARS = Array.from({ length: 69 }, (_, index) => {
  if (index < 43) return 3 + (index % 4 === 0 ? 1 : 0);
  const spikes = [17, 7, 12, 8, 4, 19, 9, 14, 8, 6, 12, 22, 9, 14, 7, 16, 8, 6, 12, 24, 10, 7, 12, 5, 4, 3];
  return spikes[index - 43] ?? 3;
});

function VoiceAvatar({ src, out }: { src?: string; out: boolean }) {
  const [failed, setFailed] = useState(false);
  return <span className={`wai-voice-avatar${out ? " is-out" : ""}`} aria-hidden="true">
    <span className="wai-voice-avatar-fallback">{out ? <span className="wai-voice-logo">IGR<span>O</span>W.</span> : <Contact size={29} />}</span>
    {src && !failed && /* eslint-disable-next-line @next/next/no-img-element -- authenticated, short-lived WhatsApp photo */
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />}
    <Mic className="wai-voice-avatar-mic" size={24} strokeWidth={2.4} />
  </span>;
}

/** WhatsApp-style voice note. The preview is fetched only when visible;
 * its duration comes from the actual audio metadata, not a fabricated value. */
function AudioPlayer({ src, out, avatarSrc, preview = false }: { src: string; out: boolean; avatarSrc?: string; preview?: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const pending = useRef<Promise<HTMLAudioElement> | null>(null);
  const speedRef = useRef(1);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const [speed, setSpeed] = useState(1);

  const prepare = useCallback(async () => {
    if (audio.current) return audio.current;
    if (pending.current) return pending.current;
    const controller = new AbortController();
    request.current = controller;
    const task = (async () => {
      const previewUrl = await loadTemporaryMedia(src, controller.signal);
      if (controller.signal.aborted) { URL.revokeObjectURL(previewUrl); throw new Error("Áudio cancelado"); }
      url.current = previewUrl;
      const element = new Audio(previewUrl);
      element.preload = "metadata";
      element.playbackRate = speedRef.current;
      element.onloadedmetadata = () => setTime(previous => ({
        current: previous.current,
        duration: Number.isFinite(element.duration) ? element.duration : 0,
      }));
      element.ontimeupdate = () => setTime({
        current: element.currentTime,
        duration: Number.isFinite(element.duration) ? element.duration : element.currentTime,
      });
      element.onplay = () => setState("playing");
      element.onpause = () => setState(previous => previous === "error" ? "error" : "paused");
      element.onended = () => { element.currentTime = 0; setTime(previous => ({ ...previous, current: 0 })); setState("paused"); };
      audio.current = element;
      element.load();
      expiry.current = setTimeout(() => {
        element.pause();
        if (url.current === previewUrl) {
          URL.revokeObjectURL(previewUrl);
          url.current = null;
          audio.current = null;
          setState("idle");
          setTime({ current: 0, duration: 0 });
        }
      }, MEDIA_PREVIEW_MS);
      return element;
    })();
    pending.current = task;
    try { return await task; } finally { pending.current = null; }
  }, [src]);

  useEffect(() => {
    const container = anchor.current;
    if (preview || !container || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        void prepare().catch(() => undefined);
      }
    }, { rootMargin: "80px 0px" });
    observer.observe(container);
    return () => observer.disconnect();
  }, [prepare, preview]);

  useEffect(() => () => {
    request.current?.abort();
    if (expiry.current) clearTimeout(expiry.current);
    audio.current?.pause();
    if (url.current) URL.revokeObjectURL(url.current);
  }, []);

  async function toggle() {
    if (preview) return;
    if (state === "playing") { audio.current?.pause(); return; }
    setState("loading");
    try { const element = await prepare(); await element.play(); }
    catch { setState("error"); }
  }
  function seek(value: number) { if (audio.current && time.duration) audio.current.currentTime = value; }
  function cycleSpeed() {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next); speedRef.current = next;
    if (audio.current) audio.current.playbackRate = next;
  }
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const progress = time.duration ? Math.min(100, (time.current / time.duration) * 100) : 0;

  if (state === "error") return <div className="wai-media"><Mic size={18} />Áudio indisponível</div>;
  return <div ref={anchor} className={`wai-voice${out ? " is-out" : ""}`}>
    <VoiceAvatar src={avatarSrc} out={out} />
    <button type="button" className="wai-voice-play" disabled={preview} onClick={() => void toggle()} aria-label={preview ? "Áudio não reproduzível nesta prévia" : state === "playing" ? "Pausar áudio" : "Tocar áudio"}>
      {state === "loading" ? <Loader2 className="wai-spin" size={25} /> : state === "playing" ? <Pause size={30} fill="currentColor" strokeWidth={0} /> : <Play size={31} fill="currentColor" strokeWidth={0} />}
    </button>
    <div className="wai-voice-track">
      <div className="wai-voice-waveform">
        <svg className="wai-voice-wave-svg" viewBox="0 0 330 40" preserveAspectRatio="none" aria-hidden="true">
          {VOICE_WAVE_BARS.map((height, index) =>
            <rect key={index} x={index * 4.75} y={(40 - height) / 2} width={2.6} height={height} rx={1.3} />)}
        </svg>
        <input type="range" min={0} max={time.duration || 1} step={0.1}
          value={time.current} onChange={event => seek(Number(event.target.value))}
          disabled={preview || !time.duration} aria-label="Posição do áudio"
          style={{ "--wai-progress": `${progress}%` } as React.CSSProperties} />
      </div>
      <small className="wai-voice-duration">{time.duration ? clock(Math.max(0, time.duration - time.current)) : state === "loading" ? "…" : "0:00"}</small>
    </div>
    {(state === "playing" || state === "paused") && <button type="button" className="wai-voice-speed" onClick={cycleSpeed} aria-label="Velocidade">{speed}×</button>}
  </div>;
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

/** WhatsApp-like message actions: emoji on hover and dropdown for contextual actions. */
function Bubble({ message, tail, showAuthor, live, voiceAvatarSrc, canReact, reactionBusy, selected, selectMode, starred,
  onStar, onReact, onCopy, onReply, onSelect, onInfo, onForward, onPin, onDelete, onView }: {
  message: InboxMessageItem; tail: boolean; showAuthor: boolean; live: boolean; voiceAvatarSrc?: string;
  canReact: boolean; reactionBusy: boolean; selected: boolean; selectMode: boolean; starred: boolean;
  onStar: () => void; onReact: (emoji: string) => void; onCopy: () => void;
  onReply: () => void; onSelect: () => void; onInfo: () => void;
  onForward: () => void; onPin: () => void; onDelete: () => void;
  onView: (displaySrc: string, downloadSrc: string) => void;
}) {
  const out = message.direction === "out";
  const [panel, setPanel] = useState<"emoji" | "menu" | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [allEmoji, setAllEmoji] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const touchHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [popupCoordinates, setPopupCoordinates] = useState<{ top: number; left: number } | null>(null);
  // Portaling to the WhatsApp shell prevents the emoji picker from being cut
  // off by the scrolling conversation viewport and keeps the same theme tokens.
  useLayoutEffect(() => {
    if (!panel || !wrapper.current || !popover.current) return;
    const calculate = () => {
      if (!wrapper.current || !popover.current) return;
      const anchor = wrapper.current.getBoundingClientRect();
      const panelBox = popover.current;
      const height = Math.min(panelBox.scrollHeight, window.innerHeight - 80);
      const width = panelBox.getBoundingClientRect().width || 324;
      const above = anchor.top - 68;
      const below = window.innerHeight - anchor.bottom - 12;
      let top: number;
      if (above >= height) top = anchor.top - height - 8;
      else if (below >= height) top = anchor.bottom + 8;
      else top = Math.max(68, Math.min(anchor.top - height / 2, window.innerHeight - height - 12));
      const idealLeft = out ? anchor.right - width : anchor.left;
      const left = Math.max(12, Math.min(idealLeft, window.innerWidth - width - 12));
      setPopupCoordinates(previous => previous?.top === top && previous?.left === left ? previous : { top, left });
    };
    calculate();
    window.addEventListener("resize", calculate);
    return () => window.removeEventListener("resize", calculate);
  }, [panel, allEmoji, out]);
  useEffect(() => {
    if (!panel) return;
    const clickAway = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) {
        setPanel(null); setAllEmoji(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPanel(null); setAllEmoji(false); }
    };
    document.addEventListener("pointerdown", clickAway);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", clickAway); document.removeEventListener("keydown", escape); };
  }, [panel]);
  const openPanel = (mode: "emoji" | "menu") => {
    setPortalHost((wrapper.current?.closest(".wai-shell") as HTMLElement | null) ?? document.body);
    setPopupCoordinates(null);
    setPanel(previous => previous === mode ? null : mode);
    setAllEmoji(false);
  };
  const cancelTouchHold = () => {
    if (touchHold.current) clearTimeout(touchHold.current);
    touchHold.current = null;
  };
  const startTouchHold = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || selectMode) return;
    cancelTouchHold();
    touchHold.current = setTimeout(() => { touchHold.current = null; openPanel("menu"); }, 550);
  };
  const choose = (emoji: string) => { setPanel(null); setAllEmoji(false); onReact(emoji); };
  const run = (fn: () => void) => { setPanel(null); setAllEmoji(false); fn(); };
  const currentMine = message.reactions?.find(item => item.mine)?.emoji;
  const meta = <span className="wai-meta">{clockTime(message.sentAt)}{out && <Ticks status={message.status} />}</span>;
  const src = `/api/whatsapp/inbox/media/${message.id}`;
  const shownLive = live && (message.kind === "image" || message.kind === "sticker" || message.kind === "video" || message.kind === "audio");
  const Icon = shownLive ? undefined : KIND_ICONS[message.kind];

  return <div className={`wai-bubble-row ${out ? "is-out" : "is-in"}${message.reactions?.length ? " has-reactions" : ""}${selected ? " is-selected" : ""}${selectMode ? " is-selection-mode" : ""}`}
    onClickCapture={selectMode ? event => {
      if ((event.target as HTMLElement).closest("label, input")) return;
      event.preventDefault(); event.stopPropagation(); onSelect();
    } : undefined}
    onPointerDown={startTouchHold}
    onPointerUp={cancelTouchHold}
    onPointerMove={cancelTouchHold}
    onPointerCancel={cancelTouchHold}
    onContextMenu={event => {
      if (selectMode) return;
      event.preventDefault(); openPanel("menu");
    }}>
    {selectMode && <label className="wai-select-message-check" aria-label="Selecionar mensagem">
      <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Selecionar mensagem das ${clockTime(message.sentAt)}`} />
    </label>}
    <div className="wai-bubble-stack" ref={wrapper}>
      <div className={`wai-bubble${tail ? " has-tail" : ""}`} id={`wai-msg-${message.id}`}>
        {showAuthor && message.author && <span className="wai-author" style={{ color: colorFor(message.author) }}>{message.author}</span>}
        {message.kind === "document" && <div className="wai-document">
          <span className="wai-document-icon"><FileText size={22} /><small>{(message.mediaName?.split(".").pop() ?? "PDF").slice(0, 4).toUpperCase()}</small></span>
          <span className="wai-document-name">{message.mediaName ?? "Documento"}</span>
        </div>}
        {message.kind === "document" && live && <div className="wai-document-actions">
          <a href={src} target="_blank" rel="noopener noreferrer">Ver</a><a href={`${src}?baixar`}>Salvar como…</a>
        </div>}
        {live && (message.kind === "image" || message.kind === "sticker") && <MediaImage src={src} sticker={message.kind === "sticker"} onView={onView} />}
        {live && message.kind === "video" && <DeferredVideo src={src} />}
        {live && message.kind === "audio" && <AudioPlayer src={src} out={out} avatarSrc={voiceAvatarSrc} />}
        {!live && message.kind === "audio" && <AudioPlayer src={src} out={out} avatarSrc={voiceAvatarSrc} preview />}
        {Icon && message.kind !== "document" && message.kind !== "audio" && !(live && shownLive) && <div className="wai-media"><Icon size={18} />{kindLabel(message.kind)}{message.kind === "contact" || message.kind === "location" ? message.body ? `: ${message.body}` : "" : ""}</div>}
        {message.kind === "template" && !message.body && <div className="wai-media"><FileText size={18} />Mensagem modelo</div>}
        {message.kind === "other" && !message.body && <div className="wai-media">Mensagem não suportada nesta tela</div>}
        {message.body && message.kind !== "contact" && message.kind !== "location" && <p className={`wai-text${message.revoked ? " is-revoked" : ""}`}><WhatsAppText text={message.body} />{meta}</p>}
        {(!message.body || message.kind === "contact" || message.kind === "location") && <div className="wai-meta-row">{meta}</div>}
      </div>
      {message.pinned && <span className="wai-message-pinned-indicator" title="Fixada no iGrow"><Pin size={12} />Fixada</span>}
      {/* Badge in the document flow AFTER the bubble: never covers timestamp or checkmarks. */}
      {!!message.reactions?.length && <div className="wai-reactions">
        <span className={`wai-reactions-group${message.reactions.some(item => item.mine) ? " is-mine" : ""}`}
          title={message.reactions.map(item => `${item.emoji}: ${item.count} ${item.count === 1 ? "reação" : "reações"}${item.mine ? " (inclui você)" : ""}`).join(" · ")}
          aria-label={`Reações nesta mensagem: ${message.reactions.map(item => `${item.emoji} ${item.count}`).join(", ")}`}>
          {message.reactions.slice(0, 3).map(item => <span key={item.emoji} className="wai-reaction-emoji" aria-hidden="true">{item.emoji}</span>)}
          {message.reactions.reduce((sum, item) => sum + item.count, 0) > 1 &&
            <small>{message.reactions.reduce((sum, item) => sum + item.count, 0)}</small>}
        </span>
      </div>}
      <div className="wai-message-controls">
        {canReact && !message.revoked && <button type="button" className="wai-message-emoji-trigger" aria-label="Reagir à mensagem" aria-expanded={panel === "emoji"}
          disabled={reactionBusy} onClick={() => openPanel("emoji")}>
          {reactionBusy ? <Loader2 size={16} className="wai-spin" /> : <Smile size={21} strokeWidth={2.3} />}
        </button>}
        <button type="button" className="wai-message-dropdown-trigger" aria-label="Mais opções da mensagem" aria-expanded={panel === "menu"}
          onClick={() => openPanel("menu")}><ChevronDown size={18} /></button>
      </div>
      {panel && portalHost && createPortal(<div ref={popover} className="wai-message-popup wai-message-popup-fixed"
        style={{ top: popupCoordinates?.top ?? 0, left: popupCoordinates?.left ?? 0, visibility: popupCoordinates ? "visible" : "hidden" }}
        role="dialog" aria-label={panel === "emoji" ? "Reagir à mensagem" : "Ações da mensagem"}>
        {canReact && <div className="wai-message-quick-reactions" aria-label="Reações rápidas">
          {QUICK_REACTIONS.map(emoji => <button type="button" key={emoji}
            className={currentMine === emoji ? "is-current" : undefined} title={currentMine === emoji ? `Remover reação ${emoji}` : `Reagir com ${emoji}`}
            aria-label={currentMine === emoji ? `Remover reação ${emoji}` : `Reagir com ${emoji}`}
            disabled={reactionBusy} onClick={() => choose(emoji)}>{emoji}</button>)}
          <button type="button" title="Mais emojis" aria-label="Mais emojis" aria-expanded={allEmoji}
            onClick={() => setAllEmoji(value => !value)}><Plus size={19} /></button>
        </div>}
        {allEmoji && canReact && <div className="wai-message-all-emoji"><EmojiPicker onPick={choose} /></div>}
        {panel === "menu" && !allEmoji && <div className="wai-message-menu-list">
          <button type="button" onClick={() => run(onInfo)}><Info size={17} />Dados da mensagem</button>
          <button type="button" onClick={() => run(onReply)} disabled={!canReact || message.revoked}><Reply size={17} />Responder</button>
          <button type="button" onClick={() => run(onCopy)} disabled={!message.body}><Copy size={17} />Copiar</button>
          <button type="button" onClick={() => run(onForward)} disabled={!live || message.revoked}><Forward size={17} />Encaminhar</button>
          <button type="button" onClick={() => run(onPin)} disabled={!live}>{message.pinned ? <PinOff size={17} /> : <Pin size={17} />}{message.pinned ? "Desafixar" : "Fixar"}</button>
          <button type="button" onClick={() => run(onStar)} disabled={!live || message.revoked}><Star size={17} fill={starred ? "currentColor" : "none"} />{starred ? "Remover dos favoritos" : "Favoritar"}</button>
          <button type="button" onClick={() => run(onSelect)}><CheckSquare size={17} />{selected ? "Desmarcar" : "Selecionar"}</button>
          {canDeleteOwnMessage(message) && <button type="button" onClick={() => run(onDelete)} disabled={!live} className="is-danger"><Trash2 size={17} />Apagar</button>}
        </div>}
      </div>, portalHost)}
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
function Composer({ conversation, kind, now, demo, canReply, replyTarget, onClearReply, onQueued, onSettled, onSent }: {
  conversation: InboxConversation; kind: "qr" | "official"; now: Date; demo: boolean; canReply: boolean;
  replyTarget: InboxMessageItem | null; onClearReply: () => void;
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
    if (replyTarget) { setError("Cancele a resposta citada antes de enviar uma gravação."); return; }
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
    if (replyTarget && file) { setError("Para responder a esta mensagem, envie apenas texto. Cancele a resposta antes de anexar um arquivo."); return; }
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
      if (replyTarget && !file) form.append("replyTo", replyTarget.id);
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
    {replyTarget && <div className="wai-reply-banner">
      <Reply size={18} />
      <span><strong>Respondendo à {replyTarget.direction === "in" ? "mensagem recebida" : "mensagem enviada"}</strong>
        <small>{replyTarget.body?.slice(0, 110) || kindLabel(replyTarget.kind)}</small></span>
      <button type="button" className="wai-icon-button" onClick={onClearReply} aria-label="Cancelar resposta"><X size={17} /></button>
    </div>}
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
        <button type="button" className={`wai-icon-button${menu === "emoji" ? " is-on" : ""}`} onClick={() => setMenu(menu === "emoji" ? null : "emoji")} aria-expanded={menu === "emoji"} title="Emojis"><EmojiStickerIcon /></button>
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
function NewChat({ contacts, conversations, onExisting, onPick, onClose }: {
  contacts: InboxContact[]; conversations: InboxConversation[]; onExisting: (id: string) => void;
  onPick: (contact: { phone: string; name: string | null; clientName: string | null }) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const digits = query.replace(/\D/g, "");
  const shown = contacts.filter(contact => !search || `${contact.name} ${contact.clientName ?? ""}`.toLocaleLowerCase("pt-BR").includes(search) || (digits.length >= 3 && contact.phone.replace(/\D/g, "").includes(digits)));
  const typed = digits.length >= 10 ? (digits.length <= 11 ? `55${digits}` : digits) : null;
  const recent = conversations.filter(item => !search ||
    `${conversationTitle(item)} ${item.remoteId} ${item.clientName ?? ""}`.toLocaleLowerCase("pt-BR").includes(search)
    || (digits.length >= 3 && item.remoteId.replace(/\D/g, "").includes(digits))).slice(0, search ? 60 : 20);
  // A saved recipient already visible as a recent conversation should not
  // appear twice in the contact picker (DDD+last 8 handles Brazil's ninth digit).
  const recentPhones = new Set(recent.filter(item => !item.remoteId.endsWith("@lid")).map(item => phoneKey(item.remoteId)));
  const recipients = shown.filter(contact => !recentPhones.has(phoneKey(contact.phone)));
  return <div className="wai-new">
    <div className="wai-new-head"><button type="button" className="wai-icon-button" onClick={onClose} aria-label="Voltar"><ArrowLeft size={20} /></button><strong>Nova conversa</strong></div>
    <label className="wai-search"><Search size={17} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Pesquisar nome ou digitar número com DDD" aria-label="Pesquisar contato ou número" /></label>
    <p className="wai-new-note">Pelo QR Code, mande mensagem só para quem conhece seu número: mensagens para desconhecidos aumentam o risco de bloqueio.</p>
    <div className="wai-rows">
      {typed && <button type="button" className="wai-row" onClick={() => onPick({ phone: typed, name: null, clientName: null })}>
        <span className="wai-avatar is-icon" style={{ width: 49, height: 49 }}><Contact size={24} /></span>
        <span className="wai-row-main"><span className="wai-row-top"><strong>Conversar com {formatWhatsAppPhone(typed)}</strong></span><span className="wai-row-client">Número digitado</span></span>
      </button>}
      {recent.length > 0 && <p className="wai-new-title">Conversas recentes deste WhatsApp</p>}
      {recent.map(item => <button type="button" key={item.id} className="wai-row" onClick={() => onExisting(item.id)}>
        <Avatar item={item} size={49} photo={false} />
        <span className="wai-row-main"><span className="wai-row-top"><strong>{conversationTitle(item)}</strong></span>
          <span className="wai-row-preview"><span>{formatWhatsAppPhone(item.remoteId)}</span></span>
          {item.clientName && <span className="wai-row-client">{item.clientName}</span>}
        </span>
      </button>)}
      {recipients.length > 0 && <p className="wai-new-title">Destinatários dos clientes</p>}
      {recipients.map(contact => <button key={contact.id} type="button" className="wai-row" onClick={() => onPick({ phone: contact.phone.replace(/\D/g, ""), name: contact.name, clientName: contact.clientName })}>
        <span className="wai-avatar" style={{ width: 49, height: 49, background: colorFor(contact.name) }}>{initialsOf(contact.name)}</span>
        <span className="wai-row-main"><span className="wai-row-top"><strong>{contact.name}</strong></span><span className="wai-row-preview"><span>{formatWhatsAppPhone(contact.phone.replace(/\D/g, ""))}</span></span>{contact.clientName && <span className="wai-row-client">{contact.clientName}</span>}</span>
      </button>)}
      {!recipients.length && !typed && !recent.length && <p className="wai-list-note">{search ? "Nenhum contato encontrado. Digite um número com DDD para iniciar uma nova conversa." : "Pesquise as conversas recentes, os destinatários dos clientes ou digite um número com DDD."}</p>}
    </div>
  </div>;
}

/** Contact and group details. The panel fetches only when requested and never preloads media. */
function ContactDetails({ item, data, loading, demo, lists, listsBusy, onToggleList, onClose }: {
  item: InboxConversation; data: DetailData | null; loading: boolean; demo: boolean;
  lists: CustomList[]; listsBusy: boolean; onToggleList: (list: CustomList,member: boolean) => void; onClose: () => void;
}) {
  const name = conversationTitle(item);
  const media = data?.media ?? [];
  const group = data?.group;
  return <aside className="wai-details" aria-label={item.isGroup ? "Informações do grupo" : "Dados do contato"}>
    <header className="wai-details-head">
      <button type="button" className="wai-icon-button" onClick={onClose} aria-label="Fechar informações"><X size={21} /></button>
      <strong>{item.isGroup ? "Informações do grupo" : "Dados do contato"}</strong>
    </header>
    <div className="wai-details-scroll">
      <div className="wai-details-identity">
        <Avatar item={item} size={100} photo={!demo} />
        <h3>{name}</h3>
        {!item.isGroup && <p>{formatWhatsAppPhone(item.remoteId)}</p>}
        {item.clientName && <span className="wai-details-chip">Cliente: {item.clientName}</span>}
      </div>
      {item.isGroup && <div className="wai-details-section">
        <h4>Sobre o grupo</h4>
        {group?.description && <p className="wai-details-description">{group.description}</p>}
        {group?.members != null && <p>{group.members} participantes</p>}
        {!group && <p className="wai-details-muted">Informações adicionais não disponíveis nesta sessão.</p>}
      </div>}
      {item.isGroup && !!group?.participants?.length && <div className="wai-details-section">
        <h4>Participantes</h4>
        {group.participants.map(participant => <div key={participant.id} className="wai-details-member">
          <Contact size={18} /><span>{participant.id.endsWith("@lid") ? `Participante · ${participant.id.split("@")[0].slice(-4)}` : formatWhatsAppPhone(participant.id.replace("@s.whatsapp.net", ""))}</span>
          {participant.admin && <small>Admin.</small>}
        </div>)}
        {group.members != null && group.members > group.participants.length && <p className="wai-details-muted">Exibindo até {group.participants.length} participantes.</p>}
      </div>}
      <div className="wai-details-section"><h4>Listas personalizadas</h4>
        <CustomListMembership lists={lists} conversationId={item.id} busy={listsBusy || demo} onToggle={onToggleList} />
      </div>
      <div className="wai-details-section">
        <h4>Mídia, links e documentos</h4>
        {loading && <p className="wai-details-muted">Carregando informações…</p>}
        {!loading && !media.length && <p className="wai-details-muted">Nenhum arquivo recente disponível.</p>}
        {media.map(file => {
          const Icon = KIND_ICONS[file.kind] ?? FileText;
          return <a key={file.id} className="wai-details-file" target="_blank" rel="noopener noreferrer"
            href={`/api/whatsapp/inbox/media/${file.id}`}>
            <Icon size={18} /><span><strong>{file.media_name || kindLabel(file.kind)}</strong>
              <small>{listTime(file.sent_at)}</small></span><Download size={15} />
          </a>;
        })}
        <p className="wai-details-muted">Até 30 arquivos recentes. Os arquivos são buscados somente ao abrir.</p>
      </div>
    </div>
  </aside>;
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
