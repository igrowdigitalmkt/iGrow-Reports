"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { disconnectLeadWhatsAppAction, loadLeadWhatsAppAction, startLeadWhatsAppAction, updateLeadWhatsAppAction, type LeadWaResult } from "./hub-actions";
import type { LeadWaMode, LeadWaView } from "./wa-session";
import { formatPairingCode } from "@/modules/whatsapp-qr/format";

const MODE_LABEL: Record<LeadWaMode, string> = { all: "Todo contato novo vira lead", ads: "Só conversas vindas de anúncio", manual: "Só quando alguém marcar" };
const QR_REFRESH_MS = 30_000;
const POLL_MS = 3_000;

type Stage = { kind: "idle" } | { kind: "qr"; image: string | null } | { kind: "pair"; code: string | null };

/** Canal WhatsApp de Leads (QR Code): conectar o número do cliente e definir quando um contato vira lead. */
export function LeadsWhatsApp({ clientId, onMessage }: { clientId: string; onMessage: (kind: "error" | "notice", text: string) => void }) {
  const [view, setView] = useState<LeadWaView | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [busy, setBusy] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<LeadWaMode>("all");
  const [ignored, setIgnored] = useState("");
  const [open, setOpen] = useState(false);
  const stageRef = useRef(stage);
  useEffect(() => { stageRef.current = stage; }, [stage]);

  const apply = useCallback((result: LeadWaResult) => {
    if (!result.ok) { onMessage("error", result.message); return null; }
    setView(result.view); setMode(result.view.qualifyMode); setIgnored(result.view.ignoredNumbers.join("\n"));
    return result;
  }, [onMessage]);

  useEffect(() => { void loadLeadWhatsAppAction({ clientId }).then(apply).catch(() => onMessage("error", "Não foi possível consultar o WhatsApp agora.")); }, [clientId, apply, onMessage]);

  const start = useCallback(async (withPhone?: string) => {
    setBusy("Gerando o código de conexão…");
    try {
      const result = await startLeadWhatsAppAction({ clientId, ...(withPhone ? { phone: withPhone } : {}) });
      const applied = apply(result);
      if (!applied || !result.ok) return;
      if (result.view.state === "connected") { setStage({ kind: "idle" }); return; }
      setStage(withPhone ? { kind: "pair", code: result.pairingCode ?? null } : { kind: "qr", image: result.qr ?? null });
    } catch { onMessage("error", "Não foi possível falar com o WhatsApp agora."); }
    finally { setBusy(""); }
  }, [clientId, apply, onMessage]);

  // Enquanto um código está na tela: confere se o celular terminou a conexão e renova o QR antes de vencer.
  const waiting = stage.kind !== "idle";
  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(async () => {
      const result = await loadLeadWhatsAppAction({ clientId }).catch(() => null);
      if (result?.ok) { setView(result.view); if (result.view.state === "connected") { setStage({ kind: "idle" }); onMessage("notice", "WhatsApp conectado. Os contatos novos deste número passam a ser percebidos pelo Groow Ads."); } }
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [waiting, clientId, onMessage]);
  useEffect(() => {
    if (stage.kind !== "qr") return;
    const renew = setTimeout(() => { if (stageRef.current.kind === "qr") void start(); }, QR_REFRESH_MS);
    return () => clearTimeout(renew);
  }, [stage, start]);

  const disconnect = async () => {
    if (!window.confirm("Desconectar o WhatsApp deste cliente? Os leads já recebidos continuam; novos contatos deixam de ser percebidos até conectar de novo.")) return;
    setBusy("Desconectando…");
    try { const applied = apply(await disconnectLeadWhatsAppAction({ clientId })); if (applied && applied.ok && applied.message) onMessage("notice", applied.message); setStage({ kind: "idle" }); }
    catch { onMessage("error", "Não foi possível desconectar agora."); }
    finally { setBusy(""); }
  };
  const saveRules = async () => {
    setBusy("Salvando as regras…");
    try { const applied = apply(await updateLeadWhatsAppAction({ clientId, qualifyMode: mode, ignoredNumbers: ignored.split(/[\n,;]+/).map(item => item.trim()).filter(Boolean) })); if (applied && applied.ok && applied.message) onMessage("notice", applied.message); }
    catch { onMessage("error", "Não foi possível salvar agora."); }
    finally { setBusy(""); }
  };

  const connected = view?.state === "connected";
  const configured = view?.configured !== false;
  return <div className="lead-wa">
    <div className="lead-wa-head">
      <div><strong>WhatsApp</strong><small>Conversas que chegam ao número do cliente. A conversa continua no celular dele; aqui entram só o contato e a primeira mensagem.</small></div>
      {view === null ? <span className="lead-badge is-off"><Loader2 size={12} className="lead-spin" aria-hidden="true" />Verificando</span>
        : connected ? <span className="lead-badge">Conectado{view.phone ? ` · ${view.phone}` : ""}</span>
          : waiting || view.state === "connecting" ? <span className="lead-badge is-off">Aguardando o celular</span>
            : <span className="lead-badge is-off">Desconectado</span>}
    </div>
    {!configured && <p className="lead-notice-line is-warn">O servidor do WhatsApp ainda não foi configurado neste ambiente.</p>}
    {view && configured && !connected && stage.kind === "idle" && <div className="lead-form-actions">
      <button type="button" className="lead-btn is-primary" onClick={() => void start()} disabled={!!busy}>{busy ? <Loader2 size={14} className="lead-spin" aria-hidden="true" /> : <QrCode size={14} aria-hidden="true" />}Mostrar QR Code</button>
      <button type="button" className="lead-btn" onClick={() => setStage({ kind: "pair", code: null })} disabled={!!busy}><KeyRound size={14} aria-hidden="true" />Conectar com código, sem câmera</button>
    </div>}
    {stage.kind === "qr" && <div className="lead-wa-stage">
      <div className="lead-wa-qr">
        {/* eslint-disable-next-line @next/next/no-img-element -- QR em base64 */}
        {stage.image ? <img src={stage.image} alt="QR Code para conectar o WhatsApp" /> : <Loader2 size={26} className="lead-spin" aria-hidden="true" />}
      </div>
      <div><h4>Escaneie com o WhatsApp do cliente</h4><p>No celular do número: <strong>Aparelhos conectados › Conectar um aparelho</strong>. Esta tela atualiza sozinha quando terminar.</p>
        <p className="lead-muted"><RefreshCw size={12} aria-hidden="true" /> O código se renova a cada 30 segundos.</p>
        <button type="button" className="lead-btn" onClick={() => setStage({ kind: "idle" })}>Cancelar</button></div>
    </div>}
    {stage.kind === "pair" && <div className="lead-wa-stage">
      {stage.code ? <div className="lead-wa-code" aria-label="Código de conexão">{formatPairingCode(stage.code)}</div>
        : <form className="lead-form-inline" onSubmit={event => { event.preventDefault(); void start(phone); }}>
          <label>Número do WhatsApp do cliente<input value={phone} onChange={event => setPhone(event.target.value)} inputMode="tel" placeholder="(86) 99999-9999" disabled={!!busy} /></label>
          <button type="submit" className="lead-btn is-primary" disabled={!!busy || phone.replace(/\D/g, "").length < 10}>Gerar código</button></form>}
      <div><h4>{stage.code ? "Digite este código no celular" : "Conectar sem câmera"}</h4><p>{stage.code ? "No WhatsApp: Aparelhos conectados › Conectar um aparelho › Conectar com número de telefone." : "Útil quando o celular está em outro lugar."}</p>
        <button type="button" className="lead-btn" onClick={() => setStage({ kind: "idle" })}>Cancelar</button></div>
    </div>}
    {busy && <p className="lead-muted" role="status"><Loader2 size={12} className="lead-spin" aria-hidden="true" /> {busy}</p>}
    {view && view.state !== "none" && <>
      <button type="button" className="lead-link-btn" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? "Ocultar regras" : "Regras de captação"}</button>
      {open && <div className="lead-wa-rules">
        <label>Quando um contato vira lead
          <select value={mode} onChange={event => setMode(event.target.value as LeadWaMode)} disabled={!!busy}>{(Object.keys(MODE_LABEL) as LeadWaMode[]).map(key => <option key={key} value={key}>{MODE_LABEL[key]}</option>)}</select></label>
        <label>Números que nunca viram lead <span className="lead-muted">(um por linha: equipe, fornecedores…)</span>
          <textarea value={ignored} onChange={event => setIgnored(event.target.value)} rows={3} placeholder="(86) 99999-9999" disabled={!!busy} /></label>
        <p className="lead-muted">A criação automática de leads por WhatsApp ainda não está ativa: por enquanto o Groow Ads só confere a conexão e guarda estas regras.</p>
        <div className="lead-form-actions"><button type="button" className="lead-btn is-primary" onClick={() => void saveRules()} disabled={!!busy}>Salvar regras</button></div>
      </div>}
      {connected && <div className="lead-form-actions"><button type="button" className="lead-btn is-danger" onClick={() => void disconnect()} disabled={!!busy}><Smartphone size={14} aria-hidden="true" />Desconectar WhatsApp</button></div>}
    </>}
    <p className="lead-muted lead-wa-safety">Número conectado por QR Code não é a API oficial: use um WhatsApp que já tenha conversas, mantenha o celular com internet e não use para envios em massa.</p>
  </div>;
}
