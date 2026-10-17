"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Palette } from "lucide-react";

const themes = [
  { id: "default", name: "Padrão", color: "#0a0a0a" },
  { id: "green", name: "Verde", color: "#10251d" },
  { id: "blue", name: "Azul", color: "#142330" },
  { id: "purple", name: "Roxo", color: "#241c30" },
  { id: "rose", name: "Rosa", color: "#301c25" },
  { id: "brown", name: "Marrom", color: "#29221a" },
] as const;
const changed = "igrow-whatsapp-theme-changed";
const storageKey = (id: string) => `igrow:whatsapp:theme:${id}`;
function read(id: string) {
  try { const value = localStorage.getItem(storageKey(id)); return themes.some(theme => theme.id === value) ? value! : "default"; }
  catch { return "default"; }
}
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(changed, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(changed, notify); };
}
export function useConversationTheme(id: string) {
  const selected = useSyncExternalStore(subscribe, () => id ? read(id) : "default", () => "default");
  return themes.find(theme => theme.id === selected) ?? themes[0];
}

export function ConversationThemeAction({ conversationId }: { conversationId: string }) {
  const current = useConversationTheme(conversationId);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string>(current.id);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (event.key === "Tab") {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('input:checked, button') ?? [])];
        const index = elements.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); elements[(index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length]?.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open]);
  return <>
    <button ref={trigger} type="button" onClick={() => { setChoice(current.id); setError(""); setOpen(true); }} aria-haspopup="dialog"><Palette size={26} /><span>Tema da conversa</span></button>
    {open && <div className="wai-details-export-backdrop" onClick={close} role="presentation">
      <div ref={dialog} className="wai-details-export wai-theme-dialog" role="dialog" aria-modal="true" aria-label="Tema da conversa" onClick={event => event.stopPropagation()}>
        <strong>Tema da conversa</strong>
        <p>Personalize o fundo desta conversa no Groow Ads. A preferência fica neste navegador e não altera o tema no WhatsApp.</p>
        <fieldset><legend>Cor do fundo</legend>{themes.map(theme => <label key={theme.id}>
          <input type="radio" name="conversation-theme" value={theme.id} checked={choice === theme.id} onChange={() => setChoice(theme.id)} />
          <span className="wai-theme-swatch" style={{ backgroundColor: theme.color }} aria-hidden="true" />{theme.name}
        </label>)}</fieldset>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" onClick={close}>Cancelar</button><button type="button" onClick={() => {
          try {
            if (choice === "default") localStorage.removeItem(storageKey(conversationId));
            else localStorage.setItem(storageKey(conversationId), choice);
            window.dispatchEvent(new Event(changed)); close();
          } catch { setError("Não foi possível salvar o tema neste navegador."); }
        }}>Salvar</button></footer>
      </div>
    </div>}
  </>;
}
