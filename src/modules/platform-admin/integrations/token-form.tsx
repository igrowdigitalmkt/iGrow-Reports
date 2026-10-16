"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { inputClass, primaryButton, secondaryButton } from "../commercial/action-form";
import { rotateWebhookTokenAction, type IntegrationFormState } from "./actions";

const initial: IntegrationFormState = { error: null, ok: null, secret: null };

/** Gera o token do webhook. O valor aparece uma única vez, só neste navegador e só até o operador fechá-lo ou sair da página. */
export function WebhookTokenForm({ hasToken }: { hasToken: boolean }) {
  const [state, action, pending] = useActionState(rotateWebhookTokenAction, initial);
  const [dismissed, setDismissed] = useState<IntegrationFormState | null>(null);
  const [copied, setCopied] = useState(false);
  const secret = state.secret && dismissed !== state ? state.secret : null;
  // O token some da tela depois de um tempo: nada fica exposto em uma aba esquecida.
  useEffect(() => {
    if (!state.secret) return;
    const timer = setTimeout(() => setDismissed(state), 120_000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    if (!secret) return;
    try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setCopied(false); }
  }

  return <form onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setCopied(false);
    startTransition(() => action(data));
  }}>
    <fieldset disabled={pending} className="m-0 min-w-0 space-y-3 border-0 p-0">
      {hasToken && <label className="block text-sm"><span className="font-medium text-[var(--secondary)]">Tempo em que o token anterior continua válido</span>
        <select name="graceMinutes" defaultValue="60" className={`${inputClass} mt-1.5`}>
          <option value="0">Encerrar já (o Asaas precisa ser atualizado imediatamente)</option>
          <option value="15">15 minutos</option><option value="60">1 hora</option><option value="240">4 horas</option><option value="1440">24 horas</option>
        </select>
        <span className="mt-1 block text-xs text-[var(--muted)]">Dá tempo de atualizar o token no painel do Asaas sem perder eventos. Depois do prazo, o anterior deixa de valer.</span></label>}
      <button type="submit" className={hasToken ? secondaryButton : primaryButton}>
        {pending ? <LoaderCircle className="animate-spin" size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}{hasToken ? "Gerar novo token" : "Gerar token do webhook"}</button>
    </fieldset>
    <div aria-live="polite" className="mt-3 space-y-2">
      {state.error && <p role="alert" className="rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-bg)] p-3 text-sm text-[var(--bad)]">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-lg border border-[var(--good)]/30 bg-[var(--good-bg)] p-3 text-sm text-[var(--good)]">{state.ok}</p>}
      {secret && <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--surface-raised)] p-3">
        <p className="text-xs font-medium text-[var(--warn)]">Copie agora. Este valor não será mostrado novamente.</p>
        <div className="mt-2 flex gap-2">
          <input readOnly value={secret} aria-label="Token do webhook (exibido uma única vez)" onFocus={(event) => event.currentTarget.select()} className={`${inputClass} font-mono`} autoComplete="off" />
          <button type="button" onClick={copy} className={secondaryButton}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "Copiado" : "Copiar"}</button>
        </div>
        <button type="button" onClick={() => setDismissed(state)} className="mt-2 text-xs text-[var(--blue)] hover:underline">Já copiei, ocultar</button>
      </div>}
    </div>
  </form>;
}
