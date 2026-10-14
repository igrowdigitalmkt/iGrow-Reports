"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import type { FormState } from "./actions";

export const inputClass = "w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--subtle)] focus:border-[var(--focus)] focus:ring-2 focus:ring-[var(--focus)]/25 disabled:opacity-50";
export const primaryButton = "inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium text-[var(--secondary)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50";
export const dangerButton = "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--bad)]/40 bg-[var(--bad-bg)] px-4 py-2 text-sm font-semibold text-[var(--bad)] hover:bg-[var(--bad)]/20 disabled:cursor-not-allowed disabled:opacity-50";

const PendingContext = createContext(false);

/**
 * Formulário com ação de servidor: mostra erro/sucesso e bloqueia os campos enquanto processa (fieldset desativado).
 * Os valores digitados são mantidos quando a ação devolve erro (o reset automático do React é evitado de propósito);
 * com resetOnSuccess o formulário é limpo só quando dá certo.
 */
export function ActionForm({ action, children, className = "space-y-4", resetOnSuccess = false }: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null, ok: null });
  const form = useRef<HTMLFormElement>(null);
  const [expired, setExpired] = useState<FormState | null>(null);
  useEffect(() => { if (state.ok && resetOnSuccess) form.current?.reset(); }, [state, resetOnSuccess]);
  // A confirmação de sucesso some sozinha: depois de outra ação na tela ela ficaria desatualizada. Erros ficam até a próxima tentativa.
  useEffect(() => {
    if (!state.ok) return;
    const timer = setTimeout(() => setExpired(state), 7000);
    return () => clearTimeout(timer);
  }, [state]);
  return <PendingContext.Provider value={pending}>
    <form ref={form} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
      startTransition(() => formAction(data));
    }}>
      <fieldset disabled={pending} className={`m-0 min-w-0 border-0 p-0 ${className}`}>{children}</fieldset>
      <div aria-live="polite" className="mt-3 space-y-2">
        {state.error && <p role="alert" className="rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-bg)] p-3 text-sm text-[var(--bad)]">{state.error}</p>}
        {state.ok && expired !== state && <p role="status" className="rounded-lg border border-[var(--good)]/30 bg-[var(--good-bg)] p-3 text-sm text-[var(--good)]">{state.ok}</p>}
      </div>
    </form>
  </PendingContext.Provider>;
}

/** Botão de envio com indicador de carregamento (lê o estado do formulário pai). */
export function SubmitButton({ children, className, name, value }: { children: ReactNode; className: string; name?: string; value?: string }) {
  const pending = useContext(PendingContext);
  return <button type="submit" name={name} value={value} disabled={pending} className={className}>{pending && <LoaderCircle className="animate-spin" size={15} aria-hidden="true" />}{children}</button>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="font-medium text-[var(--secondary)]">{label}</span><span className="mt-1.5 block">{children}</span>{hint && <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span>}</label>;
}

/** Linha de um limite: Não incluso / Limitado a N / Ilimitado. O número só vale no modo "Limitado". */
export function LimitRow({ name, label, unit, prefix, initialMode, initialValue }: {
  name: string; label: string; unit: string | null; prefix?: string; initialMode: "none" | "limit" | "unlimited"; initialValue: string;
}) {
  const [mode, setMode] = useState(initialMode);
  return <div className="grid items-center gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_11rem_9rem]">
    <div><p className="text-sm font-medium">{label}</p>{unit && <p className="text-xs text-[var(--muted)]">{unit}</p>}</div>
    <select name={`mode_${name}`} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className={inputClass} aria-label={`${label}: situação`}>
      <option value="none">Não incluso</option><option value="limit">Limitado a</option><option value="unlimited">Ilimitado</option>
    </select>
    <div className="flex items-center gap-1.5">{prefix && <span className="text-xs text-[var(--muted)]">{prefix}</span>}
      <input name={`limit_${name}`} defaultValue={initialValue} inputMode="decimal" disabled={mode !== "limit"} className={inputClass} aria-label={`${label}: valor do limite`} /></div>
  </div>;
}
