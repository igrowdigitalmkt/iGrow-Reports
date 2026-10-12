"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Contact, Heart, Loader2, MessageSquareText, Pin, PinOff, X } from "lucide-react";
import type { InboxConversation } from "./inbox-types";
import { conversationTitle } from "./inbox-format";
import { validNativeConversationState, type NativeConversationChange, type NativeConversationState } from "./conversation-controls";
import { NativeMuteAction } from "./native-mute-action";
import { CustomListMembership, type CustomList } from "./custom-lists";
export function ConversationRowMenu({ item, anchor, lists, listsBusy, demo, onToggleList, onState, onClose }: {
  item: InboxConversation; anchor: DOMRect; lists: CustomList[]; listsBusy: boolean; demo: boolean;
  onToggleList: (list: CustomList, member: boolean) => void; onState: (state: NativeConversationState, action: NativeConversationChange["action"]) => void; onClose: () => void;
}) {
  const [state, setState] = useState<NativeConversationState | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [showLists, setShowLists] = useState(false);
  const menu = useRef<HTMLDivElement>(null), latch = useRef(false);
  const url = `/api/whatsapp/inbox/${item.id}/controls`;
  useEffect(() => {
    const controller = new AbortController();
    if (!demo) void fetch(url, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok || !validNativeConversationState(body)) throw Error(body.error || "Estado indisponível.");
      if (!controller.signal.aborted) setState(body);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Estado indisponível."); });
    return () => controller.abort();
  }, [url, demo]);
  useEffect(() => {
    menu.current?.focus();
    const outside = (event: PointerEvent) => { if (!latch.current && event.target instanceof Element && !menu.current?.contains(event.target) && !event.target.closest("[role=dialog]")) onClose(); };
    const scroll = (event: Event) => { if (!latch.current && !(event.target instanceof Node && menu.current?.contains(event.target))) onClose(); };
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", scroll); window.addEventListener("scroll",scroll,true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", scroll); window.removeEventListener("scroll",scroll,true); };
  }, [onClose]);
  async function change(action: NativeConversationChange["action"], value: boolean, expected: boolean) {
    if (!state || latch.current) return;
    latch.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, value, expected }) });
      const body = await response.json();
      if (!response.ok || !validNativeConversationState(body)) throw Error(body.error || "Sem confirmação do WhatsApp.");
      setState(body); onState(body,action);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Sem confirmação."); setState(null); }
    finally { latch.current = false; setBusy(false); }
  }
  const disabled = demo || busy || !state;
  const top=Math.max(8,Math.min(anchor.bottom+5,window.innerHeight-310));
  return createPortal(<div ref={menu} className="wai-row-native-menu" role="menu" aria-label={`Opções de ${conversationTitle(item)}`} tabIndex={-1}
    style={{ left: Math.max(8, Math.min(anchor.left - 10, window.innerWidth - 238)), top, maxHeight: window.innerHeight-top-12 }}
    onKeyDown={event => {
      if (event.key === "Escape" && !busy) onClose();
      if (["ArrowUp","ArrowDown","Home","End"].includes(event.key)) {
        event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)")];
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
        buttons[next]?.focus();
      }
    }}>
    <button type="button" className="wai-row-menu-close" aria-label="Fechar opções da conversa" onClick={onClose} disabled={busy}><X size={16} /></button>
    {!state && !error && !demo && <p role="status"><Loader2 size={15} />Sincronizando com WhatsApp…</p>}
    {error && <p role="alert">{error}</p>}
    <button role="menuitem" disabled={disabled} onClick={() => void change("archive", !state!.archived, state!.archived)}><Archive size={18} />{state?.archived ? "Desarquivar conversa" : "Arquivar conversa"}</button>
    <NativeMuteAction conversationId={item.id} enabled={item.channelKey === "qr"} demo={demo} menu />
    <button role="menuitem" disabled={disabled} onClick={() => void change("pin", !state!.pinned, state!.pinned)}>{state?.pinned ? <PinOff size={18} /> : <Pin size={18} />}{state?.pinned ? "Desafixar conversa" : "Fixar conversa"}</button>
    <button role="menuitem" disabled={disabled} onClick={() => void change("unread", !state!.markedUnread, state!.markedUnread)}><MessageSquareText size={18} />{state?.markedUnread ? "Marcar como lida" : "Marcar como não lida"}</button>
    <button role="menuitem" disabled={disabled || !state?.favoritesSupported} onClick={() => void change("favorite", !state!.favorite, state!.favorite)}><Heart size={18} />{state?.favorite ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}</button>
    <button role="menuitem" onClick={() => setShowLists(value => !value)} aria-expanded={showLists}><Contact size={18} />Mudar lista</button>
    {showLists && <CustomListMembership lists={lists} conversationId={item.id} busy={listsBusy || demo} onToggle={onToggleList} />}
  </div>, document.body);
}
