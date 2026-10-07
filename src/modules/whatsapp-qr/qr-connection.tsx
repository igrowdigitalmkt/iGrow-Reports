"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Loader2, LogOut, QrCode, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPairingCode } from "./format";
import type { QrStatus } from "./server";
import "./qr-connection.css";

type Mode = { kind: "idle" } | { kind: "qr"; image: string | null } | { kind: "pair"; code: string | null };
const QR_REFRESH_MS = 30_000;
const POLL_MS = 3_000;

async function post(body: unknown) {
  const response = await fetch("/api/whatsapp/qr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { error?: string; connected?: boolean; qr?: string | null; pairingCode?: string | null };
  if (!response.ok) throw new Error(data.error ?? "Não foi possível falar com o WhatsApp agora.");
  return data;
}

type StatusResult = { ok: true; status: QrStatus } | { ok: false; error: string };
async function fetchStatus(): Promise<StatusResult> {
  const response = await fetch("/api/whatsapp/qr", { cache: "no-store" }).catch(() => null);
  const data = await response?.json().catch(() => null) as (QrStatus & { error?: string }) | null;
  if (!response?.ok || !data || data.error) return { ok: false, error: data?.error ?? "Não foi possível consultar o WhatsApp." };
  return { ok: true, status: data };
}

// Connects the workspace's own WhatsApp number (WhatsApp Web session) by QR Code or pairing code.
export function QrConnection({ canManage, onStatus }: { canManage: boolean; onStatus?: (status: QrStatus) => void }) {
  const [status, setStatus] = useState<QrStatus | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(0);
  const statusCallback = useRef(onStatus);
  useEffect(() => { statusCallback.current = onStatus; }, [onStatus]);

  const applyStatus = useCallback((result: StatusResult) => {
    if (!result.ok) { setError(result.error); return null; }
    setStatus(result.status);
    statusCallback.current?.(result.status);
    return result.status;
  }, []);
  const refreshStatus = useCallback(() => fetchStatus().then(applyStatus), [applyStatus]);

  useEffect(() => { fetchStatus().then(applyStatus); }, [applyStatus]);

  const showQr = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await post({ action: "qr" });
      if (result.connected) { await refreshStatus(); setMode({ kind: "idle" }); return; }
      setMode({ kind: "qr", image: result.qr ?? null });
      setNow(Date.now()); setExpiresAt(Date.now() + QR_REFRESH_MS);
    } catch (qrError) { setError(qrError instanceof Error ? qrError.message : "Não foi possível gerar o QR Code."); }
    finally { setBusy(false); }
  }, [refreshStatus]);

  async function requestCode() {
    setBusy(true); setError("");
    try {
      const result = await post({ action: "pair", phone });
      if (result.connected) { await refreshStatus(); setMode({ kind: "idle" }); return; }
      setMode({ kind: "pair", code: result.pairingCode ?? null });
    } catch (pairError) { setError(pairError instanceof Error ? pairError.message : "Não foi possível gerar o código."); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar este WhatsApp do iGrow? Os agendamentos param de enviar até você conectar de novo.")) return;
    setBusy(true); setError("");
    try { await post({ action: "disconnect" }); setMode({ kind: "idle" }); await refreshStatus(); }
    catch (disconnectError) { setError(disconnectError instanceof Error ? disconnectError.message : "Não foi possível desconectar."); }
    finally { setBusy(false); }
  }

  // While a code is on screen: watch for the phone to finish the link, renew the QR before it expires.
  const waiting = mode.kind !== "idle";
  useEffect(() => {
    if (!waiting) return;
    const poll = setInterval(async () => {
      const current = await refreshStatus();
      if (current && "state" in current && current.state === "connected") setMode({ kind: "idle" });
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [waiting, refreshStatus]);
  useEffect(() => {
    if (mode.kind !== "qr") return;
    const renew = setTimeout(() => { void showQr(); }, QR_REFRESH_MS);
    return () => clearTimeout(renew);
  }, [mode, showQr]);

  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const connected = status && "state" in status && status.state === "connected" ? status : null;

  return <section className="panel qr-card">
    <div className="qr-head">
      <span className={`qr-logo${connected ? " is-on" : ""}`}><Smartphone size={18} /></span>
      <div>
        <h2>Seu WhatsApp</h2>
        <p>As mensagens saem do seu próprio número, com o seu nome e a sua foto. Funciona como o WhatsApp Web.</p>
      </div>
      {status === null ? <span className="badge neutral"><Loader2 size={12} className="spin" />Verificando</span>
        : connected ? <span className="badge green"><span className="status-dot" />Conectado</span>
          : waiting ? <span className="badge blue"><span className="status-dot" />Aguardando o celular</span>
            : <span className="badge neutral"><span className="status-dot" />Desconectado</span>}
    </div>

    {status && !status.configured && <p className="qr-note"><CircleAlert size={15} />O servidor do WhatsApp ainda não foi configurado neste ambiente.</p>}

    {connected && <div className="qr-connected">
      {/* eslint-disable-next-line @next/next/no-img-element -- WhatsApp profile photo, external and short-lived */}
      {connected.picture ? <img src={connected.picture} alt="" className="qr-avatar" referrerPolicy="no-referrer" /> : <span className="qr-avatar"><CheckCircle2 size={22} /></span>}
      <div><strong>{connected.name ?? "WhatsApp conectado"}</strong><span>{connected.phone ?? "Número conectado"}</span><small>Os agendamentos ativos já podem enviar por este número.</small></div>
      {canManage && <Button variant="secondary" size="sm" onClick={disconnect} disabled={busy}><LogOut size={14} />Desconectar</Button>}
    </div>}

    {status?.configured && !connected && mode.kind === "idle" && <div className="qr-start">
      <ol className="qr-steps">
        <li><span>1</span>Abra o WhatsApp no celular do número que vai enviar</li>
        <li><span>2</span>Toque em <strong>Mais opções</strong> (⋮) ou <strong>Configurações</strong> e depois em <strong>Aparelhos conectados</strong></li>
        <li><span>3</span>Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o código</li>
      </ol>
      {canManage ? <div className="qr-actions">
        <Button onClick={showQr} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <QrCode size={15} />}Mostrar QR Code</Button>
        <Button variant="ghost" onClick={() => { setError(""); setMode({ kind: "pair", code: null }); }} disabled={busy}><KeyRound size={15} />Conectar com código, sem câmera</Button>
      </div> : <p className="qr-note">Peça a um proprietário ou administrador para conectar o WhatsApp.</p>}
    </div>}

    {mode.kind === "qr" && <div className="qr-stage">
      <div className="qr-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- base64 QR Code */}
        {mode.image ? <img src={mode.image} alt="QR Code para conectar o WhatsApp" /> : <Loader2 size={28} className="spin" />}
      </div>
      <div className="qr-stage-copy">
        <h3>Escaneie com o WhatsApp</h3>
        <p>Aparelhos conectados › Conectar um aparelho. Esta tela muda sozinha quando a conexão terminar.</p>
        <p className="qr-timer"><RefreshCw size={13} className={busy ? "spin" : undefined} />{busy ? "Gerando um novo código…" : `Novo código em ${seconds}s`}</p>
        <div className="qr-actions">
          <Button variant="ghost" size="sm" onClick={() => setMode({ kind: "pair", code: null })}><KeyRound size={14} />Usar código</Button>
          <Button variant="ghost" size="sm" onClick={() => setMode({ kind: "idle" })}>Cancelar</Button>
        </div>
      </div>
    </div>}

    {mode.kind === "pair" && <div className="qr-stage">
      {mode.code ? <div className="qr-code-box" aria-label="Código de conexão">{formatPairingCode(mode.code)}</div>
        : <form className="qr-pair-form" onSubmit={event => { event.preventDefault(); void requestCode(); }}>
          <label><span>Número do WhatsApp que vai enviar</span><input className="input" inputMode="tel" autoComplete="tel" placeholder="(86) 99999-9999" value={phone} onChange={event => setPhone(event.target.value)} /></label>
          <Button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10}>{busy ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}Gerar código</Button>
        </form>}
      <div className="qr-stage-copy">
        <h3>{mode.code ? "Digite este código no celular" : "Conectar sem câmera"}</h3>
        <p>{mode.code
          ? "No WhatsApp: Aparelhos conectados › Conectar um aparelho › Conectar com número de telefone. Digite o código ao lado."
          : "Útil quando o celular do número está em outro lugar ou a câmera não lê o QR Code."}</p>
        <div className="qr-actions">
          <Button variant="ghost" size="sm" onClick={showQr}><QrCode size={14} />Usar QR Code</Button>
          <Button variant="ghost" size="sm" onClick={() => setMode({ kind: "idle" })}>Cancelar</Button>
        </div>
      </div>
    </div>}

    {error && <p role="alert" className="meta-feedback error">{error}</p>}

    <p className="qr-safety"><ShieldCheck size={14} />Para proteger o número: use um WhatsApp que já tenha conversas, envie só para quem autorizou e mantenha o celular com internet. O iGrow espaça as mensagens como uma pessoa faria.</p>
  </section>;
}
