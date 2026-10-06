"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, Send } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buildSavedReportPdfFile } from "@/modules/reports/pdf-download";

export type SendableRecipient = { id: string; clientId: string; name: string; phone: string; authorized: boolean; reason: string | null };
type Result = { recipientId: string; name: string; status: "accepted" | "failed" | "skipped"; message?: string };

// Choose recipients and send the report PDF by WhatsApp. Only authorized recipients can be chosen.
export function SendReportDialog({ open, onOpenChange, clientId, clientName, reportVersionId, title, recipients, whatsAppReady, onSent }: {
  open: boolean; onOpenChange: (open: boolean) => void; clientId: string; clientName: string; reportVersionId: string; title: string;
  recipients: SendableRecipient[]; whatsAppReady: boolean; onSent: () => void;
}) {
  const authorized = recipients.filter(recipient => recipient.authorized);
  const [selected, setSelected] = useState<string[]>(authorized.map(recipient => recipient.id));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);

  async function send() {
    setSending(true); setError(""); setResults(null);
    try {
      const pdf = await buildSavedReportPdfFile(clientId, reportVersionId);
      const form = new FormData();
      form.append("clientId", clientId);
      form.append("reportVersionId", reportVersionId);
      for (const id of selected) form.append("recipientIds", id);
      form.append("period", pdf.period);
      form.append("filename", pdf.filename);
      form.append("file", pdf.blob, pdf.filename);
      const response = await fetch("/api/whatsapp/send", { method: "POST", body: form });
      const body = await response.json() as { results?: Result[]; error?: string };
      if (!body.results) { setError(body.error ?? "Não foi possível enviar agora."); return; }
      setResults(body.results);
      onSent();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Não foi possível gerar o PDF do relatório.");
    } finally { setSending(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!sending) onOpenChange(value); }} title="Enviar por WhatsApp" description={`${title} · ${clientName}`}>
    {!whatsAppReady && <p className="meta-inline-note">Conecte o WhatsApp e escolha a mensagem modelo em Integrações antes de enviar.</p>}
    {whatsAppReady && !recipients.length && <p className="meta-inline-note">Este cliente não tem destinatários. Cadastre em Clientes › Destinatários.</p>}
    {whatsAppReady && recipients.length > 0 && !results && <>
      <p className="muted text-sm">O PDF do relatório vai como arquivo na mensagem. Só destinatários com autorização de recebimento podem ser escolhidos.</p>
      <ul className="send-recipient-list">{recipients.map(recipient => <li key={recipient.id}>
        <label className={recipient.authorized ? undefined : "is-disabled"}>
          <input type="checkbox" disabled={!recipient.authorized || sending} checked={selected.includes(recipient.id)}
            onChange={() => setSelected(current => current.includes(recipient.id) ? current.filter(id => id !== recipient.id) : [...current, recipient.id])} />
          <span><strong>{recipient.name}</strong><small>{recipient.phone}{recipient.reason ? ` · ${recipient.reason}` : ""}</small></span>
        </label>
      </li>)}</ul>
      {error && <p role="alert" className="meta-feedback error">{error}</p>}
      <Button className="mt-5 w-full" onClick={send} disabled={sending || !selected.length}><Send size={15} />{sending ? "Gerando PDF e enviando…" : `Enviar para ${selected.length} ${selected.length === 1 ? "pessoa" : "pessoas"}`}</Button>
    </>}
    {results && <>
      <ul className="send-recipient-list">{results.map(result => <li key={result.recipientId} className="send-result">
        {result.status === "accepted" ? <CheckCircle2 size={16} className="text-emerald-500" /> : <CircleAlert size={16} className="text-amber-500" />}
        <span><strong>{result.name}</strong><small>{result.status === "accepted" ? "Enviado ao WhatsApp. A entrega e a leitura aparecem em Entregas." : result.message ?? "Não enviado"}</small></span>
      </li>)}</ul>
      <Button variant="secondary" className="mt-5 w-full" onClick={() => onOpenChange(false)}>Fechar</Button>
    </>}
  </Dialog>;
}
