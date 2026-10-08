"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Edit3, ListFilter, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { conversationTitle } from "./inbox-format";
import type { InboxConversation } from "./inbox-types";

export type CustomList = {
  id: string; name: string; color: string; sortOrder: number; conversationIds: string[];
};

const PALETTE = ["#00a884", "#53bdeb", "#d872bd", "#e9b658", "#ec8b56", "#957ad8", "#f17b82", "#8eada6"];
const API = "/api/whatsapp/inbox/lists";

export function useCustomLists(channelKey: string, demo: boolean) {
  const [listState, setListState] = useState<{ channelKey: string; items: CustomList[] }>({ channelKey, items: [] });
  const lists = !demo && listState.channelKey === channelKey ? listState.items : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (demo) return;
    const response = await fetch(API + "?channelKey=" + encodeURIComponent(channelKey), { cache: "no-store" });
    const body = await response.json().catch(() => null) as { lists?: CustomList[]; error?: string } | null;
    if (!response.ok) throw new Error(body?.error ?? "Não foi possível carregar as listas.");
    setListState({ channelKey, items: body?.lists ?? [] });
  }, [channelKey, demo]);

  useEffect(() => {
    let active = true;
    if (demo) return;
    const controller = new AbortController();
    fetch(API + "?channelKey=" + encodeURIComponent(channelKey), { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as { lists?: CustomList[]; error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "Listas indisponíveis.");
        if (active) { setListState({ channelKey, items: body?.lists ?? [] }); setError(""); }
      }).catch(failure => { if (active && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar as listas."); });
    return () => { active = false; controller.abort(); };
  }, [channelKey, demo]);

  async function request(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, id?: string) {
    if (demo || busy) return false;
    setBusy(true); setError("");
    try {
      const response = await fetch(id ? API + "?id=" + encodeURIComponent(id) : API, {
        method, headers: method === "DELETE" ? undefined : { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Falha ao atualizar a lista.");
      await refresh();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível atualizar a lista.");
      return false;
    } finally { setBusy(false); }
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

export function CustomListEditor({ list, conversations, busy, error, onClose, onSave }: {
  list: CustomList | null; conversations: InboxConversation[]; busy: boolean; error: string; onClose: () => void;
  onSave: (name: string, color: string, conversationIds: string[]) => Promise<boolean>;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const [color, setColor] = useState(list?.color ?? PALETTE[0]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(list?.conversationIds ?? []));
  const [query, setQuery] = useState("");
  const matches = conversations.filter(item =>
    !query.trim() || (conversationTitle(item) + " " + item.remoteId).toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return <div className="wai-list-dialog-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
    <section className="wai-list-dialog" role="dialog" aria-modal="true" aria-label={list ? "Editar lista" : "Criar nova lista"} onClick={event => event.stopPropagation()}>
      <header><button type="button" aria-label="Fechar" onClick={onClose} disabled={busy}><X size={22} /></button>
        <strong>{list ? "Editar lista" : "Nova lista"}</strong></header>
      <div className="wai-list-editor-scroll">
        <label className="wai-list-field">Nome da lista
          <input autoFocus maxLength={40} value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Clientes, Família, Trabalho" /></label>
        <span className="wai-list-field-label">Cor da lista</span>
        <div className="wai-list-colors" role="radiogroup" aria-label="Cor da lista">
          {PALETTE.map(value => <button key={value} type="button" role="radio" aria-checked={color === value}
            aria-label={"Cor " + value} className={color === value ? "is-active" : ""} style={{ background: value }}
            onClick={() => setColor(value)}>{color === value && <Check size={17} />}</button>)}
        </div>
        <div className="wai-list-contacts-head"><strong>Conversas</strong><span>{selected.size} selecionada(s)</span></div>
        <label className="wai-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)}
          placeholder="Pesquisar contatos e grupos" aria-label="Pesquisar contatos para a lista" /></label>
        <div className="wai-list-contact-options">
          {matches.map(item => <label key={item.id} className="wai-list-contact-item">
            <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
            <span>{conversationTitle(item)}</span><small>{item.isGroup ? "Grupo" : item.remoteId}</small>
          </label>)}
          {!matches.length && <p>Nenhuma conversa encontrada.</p>}
        </div>
      </div>
      {error && <p className="wai-list-editor-error" role="alert">{error}</p>}
      <footer><button type="button" className="wai-list-cancel" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="button" className="wai-list-primary" disabled={busy || !name.trim()} onClick={() => void onSave(name.trim(),color,[...selected])}>
          {busy ? <Loader2 size={17} className="wai-spin" /> : <Check size={17} />}{list ? "Salvar" : "Criar lista"}</button></footer>
    </section>
  </div>;
}

export function CustomListManager({ lists, busy, onBack, onCreate, onEdit, onRemove, onMove }: {
  lists: CustomList[]; busy: boolean; onBack: () => void; onCreate: () => void;
  onEdit: (list: CustomList) => void; onRemove: (list: CustomList) => void;
  onMove: (list: CustomList, delta: number) => void;
}) {
  return <div className="wai-list-manager">
    <header className="wai-new-head"><button type="button" className="wai-icon-button" onClick={onBack} aria-label="Voltar"><ArrowLeft size={21} /></button>
      <strong>Listas</strong></header>
    <button className="wai-list-create-entry" type="button" onClick={onCreate}><Plus size={20} />Nova lista<ChevronRight size={18} /></button>
    {!lists.length && <p className="wai-list-note">Crie listas para organizar conversas deste número.</p>}
    {lists.map((list,index) => <div className="wai-list-manager-row" key={list.id}>
      <span className="wai-list-color-label" style={{ background: list.color }}><ListFilter size={17} /></span>
      <button type="button" className="wai-list-manager-name" onClick={() => onEdit(list)}>
        <strong>{list.name}</strong><small>{list.conversationIds.length} conversas</small></button>
      <button type="button" aria-label={"Subir " + list.name} disabled={busy || index === 0} onClick={() => onMove(list,-1)}><ArrowUp size={16} /></button>
      <button type="button" aria-label={"Descer " + list.name} disabled={busy || index === lists.length - 1} onClick={() => onMove(list,1)}><ArrowDown size={16} /></button>
      <button type="button" aria-label={"Editar " + list.name} disabled={busy} onClick={() => onEdit(list)}><Edit3 size={17} /></button>
      <button type="button" aria-label={"Apagar " + list.name} disabled={busy} onClick={() => onRemove(list)}><Trash2 size={17} /></button>
    </div>)}
  </div>;
}

export function CustomListMembership({ lists, conversationId, busy, onToggle }: {
  lists: CustomList[]; conversationId: string; busy: boolean; onToggle: (list: CustomList, member: boolean) => void;
}) {
  if (!lists.length) return <p className="wai-list-membership-empty">Nenhuma lista personalizada criada.</p>;
  return <div className="wai-list-membership" role="group" aria-label="Adicionar a listas">
    {lists.map(list => {
      const checked = list.conversationIds.includes(conversationId);
      return <label key={list.id}><input type="checkbox" checked={checked} disabled={busy}
        onChange={() => onToggle(list,!checked)} /><span className="wai-list-dot" style={{ background: list.color }} />
        <span>{list.name}</span></label>;
    })}
  </div>;
}
