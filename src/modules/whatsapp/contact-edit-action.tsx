"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { EmojiInput } from "./emoji-input";

type Contact = { fullName: string; firstName: string; canEdit: boolean };
export function ContactEditAction({ conversationId, enabled, demo, onSaved }: {
  conversationId: string; enabled: boolean; demo: boolean; onSaved: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [fullName, setFullName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const mutation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function close() { if (mutation.current) return; setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    fetch(`/api/whatsapp/inbox/${conversationId}/contact`, { cache: "no-store", signal: abort.signal })
      .then(async response => {
        const data = await response.json() as Contact & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Não foi possível consultar o contato.");
        if (abort.signal.aborted) return;
        setContact(data); setFullName(data.fullName); setFirstName(data.firstName);
      }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Sem conexão."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, conversationId]);
  useEffect(() => { if (open && contact) dialog.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus(); }, [open, contact]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!mutation.current) { setOpen(false); trigger.current?.focus(); } }
      if (event.key === "Tab") {
        const fields = [...(dialog.current?.querySelectorAll<HTMLElement>('[contenteditable="true"],button:not(:disabled):not([hidden])') ?? [])];
        const index = fields.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); fields[(index + (event.shiftKey ? -1 : 1) + fields.length) % fields.length]?.focus();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [open]);
  async function save() {
    if (!contact?.canEdit || !enabled || mutation.current || !fullName.trim() || !firstName.trim()) return;
    mutation.current = true; setBusy(true); setError(""); dialog.current?.focus();
    try {
      const response = await fetch(`/api/whatsapp/inbox/${conversationId}/contact`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), firstName: firstName.trim(), expectedFullName: contact.fullName }) });
      const data = await response.json() as Contact & { error?: string };
      if (!mounted.current) return;
      if (!response.ok) { setError(data.error ?? "Não foi possível salvar. Reabra a edição antes de tentar novamente."); setContact(null); return; }
      onSaved(data.fullName); setOpen(false); trigger.current?.focus();
    } catch { if (mounted.current) { setError("Sem confirmação do WhatsApp. Reabra a edição antes de tentar novamente."); setContact(null); } }
    finally { mutation.current = false; if (mounted.current) setBusy(false); }
  }
  return <>
    <button ref={trigger} className="wai-icon-button wai-contact-edit" type="button" aria-label="Editar contato" title="Editar contato" disabled={!enabled || demo} onClick={() => { setLoading(true); setContact(null); setError(""); setOpen(true); }}><Pencil size={22} /></button>
    {open && <div className="wai-details-export-backdrop" role="presentation" onClick={close}>
      <div ref={dialog} tabIndex={-1} className="wai-details-export wai-contact-editor" role="dialog" aria-modal="true" aria-label="Editar contato" aria-busy={busy || loading} onClick={event => event.stopPropagation()}>
        <strong>Editar contato</strong><p>O nome será atualizado na agenda do WhatsApp conectado.</p>
        {loading && <p role="status">Consultando contato no WhatsApp…</p>}
        {contact && <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="wai-contact-editor-field"><span>Nome completo</span><EmojiInput label="Nome completo" maxLength={200} multiline={false} value={fullName} disabled={busy || !contact.canEdit} onChange={setFullName} onKeyDown={event => { if (event.key === "Enter") void save(); }} /></div>
          <div className="wai-contact-editor-field"><span>Primeiro nome</span><EmojiInput label="Primeiro nome" maxLength={100} multiline={false} value={firstName} disabled={busy || !contact.canEdit} onChange={setFirstName} onKeyDown={event => { if (event.key === "Enter") void save(); }} /></div>
        </form>}
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={close}>Cancelar</button><button type="button" disabled={loading || busy || !contact?.canEdit || !fullName.trim() || !firstName.trim() || (fullName.trim() === contact.fullName && firstName.trim() === contact.firstName)} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</button></footer>
      </div>
    </div>}
  </>;
}
