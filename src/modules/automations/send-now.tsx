"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { sendAutomationNowAction } from "./actions";

type Outcome = { status: "sent" | "partial" | "failed" | "skipped"; sent: number; failed: number; message: string | null };

const RESULT: Record<Outcome["status"], string> = {
  sent: "Mensagens enviadas.",
  partial: "Parte das mensagens foi enviada.",
  failed: "O envio falhou.",
  skipped: "Nada foi enviado.",
};

/**
 * Sends the automation right away. `prepare` runs first (the editor saves the current version)
 * and returns the automation id to send.
 */
export function SendNowButton({ prepare, recipients, periodLabel, demo = false, variant = "secondary", size, onDone }: {
  prepare: () => Promise<string | null>; recipients: number; periodLabel: string; demo?: boolean;
  variant?: "default" | "secondary" | "ghost"; size?: "sm"; onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");

  async function send() {
    setError(""); setOutcome(null);
    if (demo) { setError("Na demonstração nenhuma mensagem é enviada."); return; }
    setSending(true);
    try {
      const id = await prepare();
      if (!id) return;
      const result = await sendAutomationNowAction({ id });
      if ("error" in result) { setError(result.error ?? "Não foi possível enviar agora."); return; }
      setOutcome(result);
      onDone?.();
    } catch {
      setError("Não foi possível enviar agora.");
    } finally { setSending(false); }
  }

  return <>
    <Button type="button" variant={variant} size={size} onClick={() => { setOpen(true); setOutcome(null); setError(""); }}><Send size={14} />Enviar agora</Button>
    <Dialog open={open} onOpenChange={value => { if (!sending) setOpen(value); }} title="Enviar agora" description="Envia esta mensagem já, fora do horário. Os próximos envios continuam nos dias e horários agendados.">
      {!outcome ? <div className="send-now">
        <p>A mensagem vai para <strong>{recipients} {recipients === 1 ? "destino" : "destinos"}</strong> com os números de <strong>{periodLabel.toLowerCase()}</strong>. As mensagens saem com alguns segundos de intervalo, como uma pessoa enviaria.</p>
        {error && <p role="alert" className="meta-feedback error">{error}</p>}
        <div className="template-save-actions">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={sending}>Cancelar</Button>
          <Button type="button" onClick={send} disabled={sending || !recipients}>{sending ? <><Loader2 size={15} className="spin" />Enviando…</> : <><Send size={15} />Enviar agora</>}</Button>
        </div>
      </div> : <div className="send-now">
        <p className={`send-now-result is-${outcome.status}`}>{outcome.status === "sent" ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<span><strong>{RESULT[outcome.status]}</strong>{outcome.sent + outcome.failed > 0 && ` ${outcome.sent} ${outcome.sent === 1 ? "enviada" : "enviadas"}${outcome.failed ? `, ${outcome.failed} com falha` : ""}.`}</span></p>
        {outcome.message && <p className="send-now-detail">{outcome.message}</p>}
        <p className="send-now-detail">O resultado também fica em Relatórios › Entregas.</p>
        <Button type="button" className="w-full" onClick={() => setOpen(false)}>Fechar</Button>
      </div>}
    </Dialog>
  </>;
}
