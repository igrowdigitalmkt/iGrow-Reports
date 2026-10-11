"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { EmojiInput, type EmojiInputHandle } from "./emoji-input";
import { EmojiPicker } from "./emoji-picker";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, Edit3, ListFilter, Loader2, MoreVertical, Palette, Plus, Search, Smile, Trash2, UsersRound, X } from "lucide-react";
import { colorFor, conversationTitle, initialsOf } from "./inbox-format";
import type { InboxConversation } from "./inbox-types";
import { CUSTOM_LABEL_COLORS } from "./native-labels";

export type CustomList = { id: string; name: string; color: string; sortOrder: number; conversationIds: string[]; };
const PALETTE = CUSTOM_LABEL_COLORS;
const SUGGESTIONS = [
  { name: "Novo pedido", color: PALETTE[2] },
  { name: "Pagamento pendente", color: PALETTE[3] },
  { name: "Acompanhar", color: PALETTE[10] },
  { name: "Pago", color: PALETTE[5] },
  { name: "Pedido finalizado", color: PALETTE[7] },
  { name: "Importante", color: PALETTE[0] },
];
// Read-only sample lists for visual checks in the isolated demo; never sent to the API.
const DEMO_LISTS: CustomList[] = [
  { id: "demo-new-client", name: "Novo cliente", color: "#a2bb41", sortOrder: 0, conversationIds: ["d2"] },
  { id: "demo-lead", name: "Lead", color: "#76cdae", sortOrder: 1, conversationIds: ["d2"] },
  { id: "demo-order", name: "Novo pedido", color: "#bd9b38", sortOrder: 2, conversationIds: ["d2"] },
  { id: "demo-payment", name: "Pagamento pendente", color: "#a3297b", sortOrder: 3, conversationIds: ["d2"] },
];

export function useCustomLists(channelKey: string, demo: boolean) {
  const API = channelKey === "qr" ? "/api/whatsapp/inbox/native-labels" : "/api/whatsapp/inbox/lists";
  const [listState, setListState] = useState<{ channelKey: string; items: CustomList[] }>({ channelKey, items: [] });
  const lists = demo ? channelKey === "qr" ? DEMO_LISTS : [] : listState.channelKey === channelKey ? listState.items : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false);
  const refreshVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (demo) return;
    const version = ++refreshVersion.current;
    const response = await fetch(API + "?channelKey=" + encodeURIComponent(channelKey), { cache: "no-store" });
    const body = await response.json().catch(() => null) as { lists?: CustomList[]; error?: string } | null;
    if (version !== refreshVersion.current) return;
    if (!response.ok) throw new Error(body?.error ?? "Não foi possível carregar as listas.");
    if (version === refreshVersion.current) { setListState({ channelKey, items: body?.lists ?? [] }); setError(""); }
  }, [API, channelKey, demo]);

  useEffect(() => {
    if (demo || channelKey !== "qr" || busy) return;
    const timer = setInterval(() => { void refresh().catch(() => setError("Não foi possível sincronizar as etiquetas do WhatsApp.")); }, 15_000);
    return () => clearInterval(timer);
  }, [channelKey, demo, busy, refresh]);

  useEffect(() => {
    let active = true;
    if (demo) return;
    const controller = new AbortController();
    const version = ++refreshVersion.current;
    fetch(API + "?channelKey=" + encodeURIComponent(channelKey), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as { lists?: CustomList[]; error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "Listas indisponíveis.");
        if (active && version === refreshVersion.current) { setListState({ channelKey, items: body?.lists ?? [] }); setError(""); }
      }).catch(failure => { if (active && version === refreshVersion.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar as listas."); });
    return () => { active = false; controller.abort(); };
  }, [API, channelKey, demo]);

  async function request(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, id?: string) {
    if (demo || writing.current) return false;
    writing.current = true;
    refreshVersion.current++;
    setBusy(true); setError("");
    try {
      const response = await fetch(id ? API + "?id=" + encodeURIComponent(id) : API, {
        method, headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { error?: string; warning?:string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Falha ao atualizar a lista.");
      // A successful native write must not become a failed create just because
      // its follow-up read failed: retrying could create a duplicate label.
      await refresh().catch(() => setError("Alteração salva no WhatsApp. Não foi possível atualizar a exibição; aguarde a sincronização."));
      if(payload?.warning)setError(payload.warning);
      return true;
    } catch (failure) {
      // Some remote changes can have succeeded before a later peer fails. Re-read the device state.
      if (channelKey === "qr") await refresh().catch(() => undefined);
      setError(failure instanceof Error ? failure.message : "Não foi possível atualizar a lista.");
      return false;
    } finally { writing.current = false; setBusy(false); }
  }

  return {
    lists, busy, error, clearError: () => setError(""),
    create: (name: string, color: string, conversationIds: string[]) =>
      request("POST", { name, color, conversationIds, channelKey }),
    update: (id: string, value: Partial<Pick<CustomList, "name" | "color" | "conversationIds" | "sortOrder">>) =>
      request("PATCH", { id, ...value }),
    setMember: (id: string, conversationId: string, member: boolean) =>
      request("PATCH", { id, conversationId, member }),
    remove: (id: string) => request("DELETE", {}, id),
  };
}

/** Keep private WhatsApp media lazy; the user's session determines which pictures exist. */
function ListAvatar({ item, demo }: { item: InboxConversation; demo:boolean }) {
  const [failed, setFailed] = useState(false);
  const name = conversationTitle(item);
  return <span className="wai-list-picker-avatar" style={{ background: item.isGroup ? "#341723" : colorFor(name) }}>
    {item.isGroup ? <UsersRound size={22} /> : initialsOf(name)}
    {!demo && !failed && item.channelKey === "qr" && /* eslint-disable-next-line @next/next/no-img-element -- session-scoped WhatsApp avatar */
      <img src={`/api/whatsapp/inbox/avatar/${item.id}`} alt="" loading="lazy" onError={() => setFailed(true)} />}
  </span>;
}

export function CustomListEditor({ list, conversations, busy, error, onClose, onSave, demo=false }: {
  list: CustomList | null; conversations: InboxConversation[]; busy: boolean; error: string; onClose: () => void; demo?:boolean;
  onSave: (name: string, color: string, conversationIds: string[]) => Promise<boolean>;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const [color, setColor] = useState(list?.color ?? PALETTE[2]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(list?.conversationIds ?? []));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [emojisOpen, setEmojisOpen] = useState(false);
  const nameInput = useRef<EmojiInputHandle>(null);
  const matches = conversations.filter(item =>
    !query.trim() || (conversationTitle(item) + " " + item.remoteId).toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  function toggle(id: string) {
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  return <section className="wai-custom-editor" aria-label={list ? "Editar lista" : "Criar nova lista"}>
    <header className="wai-custom-editor-head"><button type="button" aria-label="Voltar" onClick={onClose}><ArrowLeft size={22} /></button>
      <strong>{list ? "Editar lista" : "Criar nova lista"}</strong></header>
    <div className="wai-custom-editor-scroll">
      <span className="wai-custom-editor-label">Nome da lista</span>
      <div className="wai-custom-editor-name">
        <EmojiInput ref={nameInput} label="Nome da lista" autoFocus multiline={false} maxLength={40} value={name} onChange={setName}/>
        <button type="button" aria-label="Adicionar emoji ao nome" title="Adicionar emoji ao nome" aria-expanded={emojisOpen} onClick={() => { setColorsOpen(false); setEmojisOpen(value=>!value); }}><Smile size={24}/></button>
        <button type="button" className="wai-custom-color-button" title="Escolher cor" aria-label="Escolher cor" aria-expanded={colorsOpen} onClick={() => {setEmojisOpen(false);setColorsOpen(value => !value);}}>
          <span style={{ background: color }} />
        </button>
        {colorsOpen && <div className="wai-custom-colors" role="radiogroup" aria-label="Cor da lista">
          {PALETTE.map(value => <button key={value} type="button" role="radio" aria-checked={value === color} title={value} style={{ background: value }}
            onClick={() => { setColor(value); setColorsOpen(false); }}>{value === color && <Check size={16} />}</button>)}
        </div>}
      </div>
      {emojisOpen && <div className="wai-custom-name-emojis" onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();setEmojisOpen(false);nameInput.current?.focus();}}}><EmojiPicker onPick={emoji=>{nameInput.current?.insertText(emoji);setEmojisOpen(false);}}/></div>}
      {!name.trim() && !list && <div className="wai-custom-suggestions"><h3>Sugestões</h3>
        {SUGGESTIONS.map(item => <button type="button" key={item.name} onClick={() => { setName(item.name); setColor(item.color); }}>
          <span className="wai-custom-list-dot" style={{ background: item.color }} />{item.name}</button>)}
      </div>}
      <div className="wai-custom-members">
        <h3>Conversas incluídas</h3>
        {conversations.filter(item => selected.has(item.id)).map(item => <button key={item.id} type="button" className="wai-custom-member" title="Remover da lista" onClick={() => toggle(item.id)}>
          <ListAvatar item={item} demo={demo}/><span>{conversationTitle(item)}</span><X size={17}/></button>)}
        <button type="button" className="wai-custom-add-members" onClick={() => setPickerOpen(true)}>
          <span className="wai-custom-big-plus"><Plus size={29} /></span>Adicionar pessoas ou grupos</button>
      </div>
      {error && <p className="wai-list-editor-error" role="alert">{error}</p>}
      <button type="button" className="wai-custom-create" disabled={busy || !name.trim()} onClick={() => void onSave(name.trim(),color,[...selected])}>
        {busy && <Loader2 size={15} className="wai-spin" />}{list ? "Salvar lista" : "Criar lista"}
      </button>
    </div>
    <Dialog.Root open={pickerOpen} onOpenChange={setPickerOpen}><Dialog.Overlay className="wai-custom-picker-backdrop">
      <Dialog.Content className="wai-custom-picker" aria-describedby={undefined}>
        <header><button type="button" aria-label="Fechar" onClick={() => setPickerOpen(false)}><X size={22} /></button><Dialog.Title asChild><strong>Adicionar à lista</strong></Dialog.Title></header>
        <label className="wai-custom-picker-search"><Search size={20}/><input autoFocus placeholder="Pesquisar nome, número ou @nomedeusuário"
          value={query} onChange={event => setQuery(event.target.value)}/></label>
        <div className="wai-custom-picker-list"><h4>Conversas recentes</h4>
          {matches.map(item => <label key={item.id} className="wai-custom-picker-row">
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
            <ListAvatar item={item} demo={demo}/><span><strong>{conversationTitle(item)}</strong>
              {item.isGroup && <small>Grupo</small>}</span>
          </label>)}
          {!matches.length && <p className="wai-list-note">Nenhuma conversa encontrada.</p>}
        </div>
        <button type="button" className="wai-custom-picker-done" onClick={() => { setPickerOpen(false); setQuery(""); }} aria-label="Concluir seleção de conversas"><Check size={22}/></button>
      </Dialog.Content>
    </Dialog.Overlay></Dialog.Root>
  </section>;
}

export function CustomListManager({ lists, busy, onBack, onCreate, onEdit, onRemove, onMove }: {
  lists: CustomList[]; busy: boolean; onBack: () => void; onCreate: () => void;
  onEdit: (list: CustomList) => void; onRemove: (list: CustomList) => void; onMove: (list: CustomList, delta: number) => void;
}) {
  const [menu, setMenu] = useState<string|null>(null);
  const [reordering, setReordering] = useState(false);
  const [options, setOptions] = useState(false);
  return <section className="wai-custom-manager" aria-label="Gerenciar listas">
    <header className="wai-custom-manager-head">
      <button type="button" aria-label="Fechar listas" onClick={onBack}><X size={23}/></button>
      <strong>Listas</strong>
      <button type="button" aria-label="Criar lista" onClick={onCreate} className="wai-custom-manager-plus"><Plus size={23}/></button>
      <div className="wai-custom-manager-options">
        <button type="button" aria-label="Opções das listas" aria-expanded={options} onClick={() => setOptions(value => !value)}><MoreVertical size={22}/></button>
        {options && <div className="wai-custom-options-menu"><button type="button" disabled={lists.some(list => list.id.startsWith("wa:"))} title={lists.some(list => list.id.startsWith("wa:")) ? "Ordem definida pelo WhatsApp" : undefined} onClick={() => { setReordering(value => !value); setOptions(false); }}>
          <ListFilter size={17}/>{reordering ? "Concluir ordem" : "Reordenar"}</button></div>}
      </div>
    </header>
    <div className="wai-custom-manager-rows">
      {lists.map((list,index) => <div key={list.id} className="wai-custom-manager-item">
        <span className="wai-custom-list-dot" style={{ background:list.color }}/>
        <button type="button" className="wai-custom-manager-title" onClick={() => onEdit(list)}>
          <strong>{list.name}</strong><small>{list.conversationIds.length} {list.conversationIds.length === 1 ? "conversa" : "conversas"}</small></button>
        {reordering && <div className="wai-custom-order-actions">
          <button type="button" disabled={busy || index === 0} aria-label={`Subir ${list.name}`} onClick={() => onMove(list,-1)}><ArrowUp size={18}/></button>
          <button type="button" disabled={busy || index === lists.length-1} aria-label={`Descer ${list.name}`} onClick={() => onMove(list,1)}><ArrowDown size={18}/></button>
        </div>}
        {!reordering && <button type="button" className="wai-custom-manager-caret" aria-label={`Opções de ${list.name}`} aria-expanded={menu === list.id} onClick={() => setMenu(current => current === list.id ? null : list.id)}><ChevronDown size={19}/></button>}
        {menu === list.id && <div className="wai-custom-manager-context" role="menu">
          <button type="button" onClick={() => { setMenu(null); onEdit(list); }}><Edit3 size={17}/>Editar</button>
          <button type="button" onClick={() => { setMenu(null); onEdit(list); }}><Palette size={17}/>Escolher cor</button>
          <button type="button" onClick={() => { setMenu(null); onRemove(list); }}><Trash2 size={17}/>Apagar</button>
        </div>}
      </div>)}
      {!lists.length && <p className="wai-list-note">Nenhuma lista ainda. Use + para criar a primeira.</p>}
    </div>
  </section>;
}

export function CustomListMembership({ lists, conversationId, busy, onToggle }: {
  lists: CustomList[]; conversationId: string; busy: boolean; onToggle: (list: CustomList, member: boolean) => void;
}) {
  if (!lists.length) return <p className="wai-list-membership-empty">Nenhuma lista personalizada criada.</p>;
  return <div className="wai-list-membership" role="group" aria-label="Adicionar a listas">
    {lists.map(list => { const checked = list.conversationIds.includes(conversationId); return <label key={list.id}>
      <span className="wai-list-dot" style={{ background: list.color }} /><span>{list.name}</span>
      <input type="checkbox" checked={checked} disabled={busy} onChange={() => onToggle(list,!checked)} /></label>; })}
  </div>;
}
