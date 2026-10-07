"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrCode, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadFacebookSdk, selectFacebookApp, type FacebookSdk } from "@/modules/meta/facebook-sdk";
import { connectWhatsAppEmbeddedAction } from "./actions";
import { EMBEDDED_SIGNUP_COEXISTENCE, parseEmbeddedSignupMessage } from "./embedded-signup";

type Session = { wabaId: string; phoneNumberId: string; coexistence: boolean };

/**
 * Meta Embedded Signup. With coexistence the person scans a QR code inside the WhatsApp
 * Business app and keeps using the same number on the phone; no IDs or tokens to copy.
 */
export function EmbeddedSignupButton({ configId, apiVersion, appId }: { configId: string; apiVersion: string; appId: string }) {
  const router = useRouter();
  const sdk = useRef<FacebookSdk | null>(null);
  const session = useRef<Session | null>(null);
  const code = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadFacebookSdk(apiVersion).then(value => { if (!cancelled) { sdk.current = value; setReady(true); } })
      .catch(() => { if (!cancelled) setError("Não foi possível carregar o login da Meta. Atualize a página."); });
    const onMessage = (event: MessageEvent) => {
      const result = parseEmbeddedSignupMessage(event.origin, event.data);
      if (!result) return;
      if (result.kind === "finish") { session.current = result; finish(); }
      else if (result.kind === "cancel") { setWaiting(false); setNotice("Conexão interrompida. Você pode tentar de novo quando quiser."); }
      else { setWaiting(false); setError(result.message); }
    };
    window.addEventListener("message", onMessage);
    return () => { cancelled = true; window.removeEventListener("message", onMessage); };
    // finish reads refs only; the listener is registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiVersion]);

  // The code (login callback) and the chosen number (window message) arrive separately.
  function finish() {
    const currentSession = session.current, currentCode = code.current;
    if (!currentSession || !currentCode) return;
    session.current = null; code.current = null;
    startTransition(async () => {
      const result = await connectWhatsAppEmbeddedAction({ code: currentCode, ...currentSession });
      setWaiting(false);
      if ("error" in result) { setError(result.error ?? "Não foi possível conectar."); return; }
      setNotice([
        `WhatsApp conectado${result.displayPhone ? `: ${result.displayPhone}` : ""}.`,
        result.template ? `Mensagem modelo "${result.template}" pronta.` : "Crie a mensagem modelo do relatório e aguarde a aprovação (passo a passo abaixo).",
        result.registrationWarning ?? "",
      ].filter(Boolean).join(" "));
      router.refresh();
    });
  }

  function start(coexistence: boolean) {
    if (!sdk.current) return;
    setError(""); setNotice(""); setWaiting(true);
    session.current = null; code.current = null;
    try {
      selectFacebookApp(sdk.current, appId, apiVersion);
      sdk.current.login(response => {
        const value = response.authResponse?.code;
        if (!value) { setWaiting(false); setNotice("Autorização não concluída. Você pode tentar novamente."); return; }
        code.current = value;
        finish();
      }, {
        config_id: configId, response_type: "code", override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: "3", ...(coexistence ? { featureType: EMBEDDED_SIGNUP_COEXISTENCE } : {}) },
      });
    } catch {
      setWaiting(false);
      setError("Não foi possível abrir a janela da Meta. Permita pop-ups para o iGrow e tente novamente.");
    }
  }

  return <div className="embedded-signup">
    <div className="embedded-signup-options">
      <button type="button" className="embedded-option is-primary" onClick={() => start(true)} disabled={!ready || waiting || pending}>
        <QrCode size={22} />
        <span><strong>Usar o número do meu WhatsApp Business</strong><small>Escaneie um código QR no app do celular. O número continua funcionando normalmente no aplicativo.</small></span>
      </button>
      <button type="button" className="embedded-option" onClick={() => start(false)} disabled={!ready || waiting || pending}>
        <Smartphone size={22} />
        <span><strong>Usar um número novo</strong><small>Um número que ainda não está no WhatsApp. A confirmação é por SMS ou ligação.</small></span>
      </button>
    </div>
    {(waiting || pending) && <div className="embedded-status"><span>{pending ? "Concluindo a conexão…" : "Siga as etapas na janela da Meta…"}</span>{waiting && !pending && <Button variant="ghost" className="button-sm" onClick={() => setWaiting(false)}>Cancelar</Button>}</div>}
    {error && <p role="alert" className="meta-feedback error">{error}</p>}
    {notice && <p role="status" className="meta-feedback success">{notice}</p>}
  </div>;
}
