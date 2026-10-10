"use client";

import { useEffect, useRef, useState } from "react";
import { CircleX } from "lucide-react";
import { WhatsAppEmojiText } from "./whatsapp-emoji";

export function ContactBlockAction({ conversationId, name, enabled, demo = false }: {
  conversationId: string; name: string; enabled: boolean; demo?: boolean;
}) {
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [canBlock, setCanBlock] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (demo || busy || confirm) return;
    const controller = new AbortController();
    let running = false;
    async function read() {
      if (running) return;
      running = true;
      try {
        const response = await fetch(`/api/whatsapp/inbox/${conversationId}/block`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { blocked?: boolean; canBlock?: boolean; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || typeof result.blocked !== "boolean") throw new Error(result.error || "Estado do bloqueio indisponível.");
        setBlocked(result.blocked); setCanBlock(result.canBlock !== false); setError("");
      } catch (error) {
        if (!controller.signal.aborted) { setBlocked(null); setError(error instanceof Error ? error.message : "Estado do bloqueio indisponível."); }
      } finally { running = false; }
    }
    void read();
    const timer = setInterval(() => void read(), 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [conversationId, demo, busy, confirm, refresh]);
  useEffect(() => {
    if (!confirm) return;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!busy) { setConfirm(false); trigger.current?.focus(); }
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const next = (buttons.indexOf(document.activeElement as HTMLButtonElement) + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [confirm, busy]);
  async function submit() {
    if (blocked === null || !canBlock || busy || !enabled || demo) return;
    const desired = !blocked;
    setBusy(true); setError(""); setActionError("");
    try {
      const response = await fetch(`/api/whatsapp/inbox/${conversationId}/block`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocked: desired }),
      });
      const result = await response.json() as { blocked?: boolean; error?: string };
      if (!alive.current) return;
      if (!response.ok || result.blocked !== desired) throw new Error(result.error || "O WhatsApp não confirmou a alteração.");
      setBlocked(result.blocked); setConfirm(false); trigger.current?.focus();
    } catch (error) {
      if (alive.current) { setBlocked(null); setConfirm(false); setActionError(error instanceof Error ? error.message : "Sem conexão. Consulte o estado novamente."); trigger.current?.focus(); }
    } finally { if (alive.current) setBusy(false); }
  }
  return <>
    {canBlock && <button type="button" className="wai-contact-danger" ref={trigger} disabled={demo || !enabled || blocked === null || busy}
      onClick={() => { setActionError(""); setConfirm(true); }}><CircleX size={26} /><span>{blocked ? "Desbloquear" : "Bloquear"} <WhatsAppEmojiText text={name} /></span></button>}
    {actionError && <div className="wai-block-status"><p role="alert">{actionError}</p></div>}
    {!demo && blocked === null && <div className="wai-block-status">
      <p role={error ? "alert" : "status"}>{error || "Consultando bloqueio no WhatsApp…"}</p>
      {error && <button type="button" onClick={() => setRefresh(value => value + 1)}>Atualizar estado</button>}
    </div>}
    {confirm && <div className="wai-details-export-backdrop" role="presentation" onClick={() => { if (!busy) { setConfirm(false); trigger.current?.focus(); } }}>
      <div ref={dialog} className="wai-details-export" role="dialog" aria-modal="true" aria-label={blocked ? "Desbloquear contato" : "Bloquear contato"} aria-busy={busy} onClick={event => event.stopPropagation()}>
        <strong>{blocked ? "Desbloquear" : "Bloquear"} <WhatsAppEmojiText text={name} />?</strong>
        <p>{blocked ? "Este contato poderá voltar a enviar mensagens e ligar para você no WhatsApp." : "Este contato não poderá enviar mensagens nem ligar para você no WhatsApp. A conversa será mantida."}</p>
        <footer><button type="button" disabled={busy} onClick={() => { setConfirm(false); trigger.current?.focus(); }}>Cancelar</button>
          <button type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Sincronizando…" : blocked ? "Desbloquear" : "Bloquear"}</button></footer>
      </div>
    </div>}
  </>;
}
