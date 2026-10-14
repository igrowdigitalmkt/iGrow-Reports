"use client";

import { useActionState, useState, useTransition } from "react";
import { KeyRound, LoaderCircle, QrCode, ShieldCheck } from "lucide-react";
import { startMfaEnrollmentAction, verifyMfaAction } from "./mfa-actions";

const fieldClass = "mt-2 w-full max-w-xs rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-[var(--text)] outline-none focus:border-[var(--focus)] focus:ring-2 focus:ring-[var(--focus)]/25";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50";

function CodeForm({ factorId, label }: { factorId: string; label: string }) {
  const [state, action, pending] = useActionState(verifyMfaAction, { error: null });
  return <form action={action} className="mt-5">
    <input type="hidden" name="factorId" value={factorId} />
    <label htmlFor="code" className="block text-sm font-medium text-[var(--secondary)]">Código de 6 dígitos do aplicativo</label>
    <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className={fieldClass} placeholder="000000" disabled={pending} />
    <div aria-live="polite">{state.error && <p role="alert" className="mt-3 max-w-md rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-bg)] p-3 text-sm text-[var(--bad)]">{state.error}</p>}</div>
    <button type="submit" disabled={pending} className={`${buttonClass} mt-4`}>{pending ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}{pending ? "Verificando…" : label}</button>
  </form>;
}

/** mode "verify": já há autenticador (pede o código). mode "enroll": primeiro cadastro (QR Code). */
export function MfaPanel({ mode, factorId, addingAnother = false }: { mode: "verify" | "enroll"; factorId?: string; addingAnother?: boolean }) {
  const [enrollment, setEnrollment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (mode === "verify" && factorId) return <CodeForm factorId={factorId} label="Confirmar e entrar" />;
  if (enrollment) return <div className="mt-5">
    <p className="text-sm text-[var(--secondary)]">1. Leia o QR Code com um aplicativo autenticador (Google Authenticator, Authy, 1Password…).</p>
    {/* O QR Code é um SVG em data URI: exibido como imagem, sem executar scripts. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={enrollment.qrCode} alt="QR Code para cadastrar o autenticador" width={176} height={176} className="mt-3 rounded-lg bg-white p-2" />
    <details className="mt-3 text-sm text-[var(--muted)]"><summary className="cursor-pointer">Não consegue ler o QR Code? Use a chave</summary><code className="mt-2 block break-all rounded-lg bg-[var(--surface-raised)] p-2 font-mono text-xs text-[var(--text)]">{enrollment.secret}</code></details>
    <p className="mt-4 text-sm text-[var(--secondary)]">2. Digite o código que o aplicativo mostrar.</p>
    <CodeForm factorId={enrollment.factorId} label={addingAnother ? "Confirmar novo autenticador" : "Ativar e entrar"} />
  </div>;
  return <div className="mt-5">
    <div aria-live="polite">{error && <p role="alert" className="mb-3 max-w-md rounded-lg border border-[var(--bad)]/30 bg-[var(--bad-bg)] p-3 text-sm text-[var(--bad)]">{error}</p>}</div>
    <button type="button" disabled={pending} className={buttonClass} onClick={() => startTransition(async () => {
      const result = await startMfaEnrollmentAction();
      if (result.error === null) { setError(null); setEnrollment({ factorId: result.factorId, qrCode: result.qrCode, secret: result.secret }); } else setError(result.error);
    })}>{pending ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <QrCode size={16} aria-hidden="true" />}{addingAnother ? "Adicionar outro autenticador" : "Configurar autenticador"}</button>
    {!addingAnother && <p className="mt-3 flex items-start gap-2 text-xs text-[var(--muted)]"><KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden="true" />Recomendado: cadastre também um segundo autenticador, em outro aparelho, para não perder o acesso.</p>}
  </div>;
}
