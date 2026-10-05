"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { acceptInvitationAction, loginAction, setPasswordAction } from "./actions";

const fieldClass = "mt-2 w-full rounded-xl border border-white/10 bg-[#0c111b] px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50";
const submitClass = "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-45";

function FormError({ error }: { error: string | null }) {
  return <div aria-live="polite">{error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}</div>;
}

export function LoginForm({ configured, next }: { configured: boolean; next: string }) {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  return (
    <form action={action} className="mt-7">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="block text-sm font-medium text-slate-300"><Mail size={14} className="mr-2 inline" />E-mail da equipe</label>
      <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} placeholder="voce@suaagencia.com.br" className={fieldClass} disabled={!configured || pending} />
      <label htmlFor="password" className="mt-5 block text-sm font-medium text-slate-300"><LockKeyhole size={14} className="mr-2 inline" />Senha</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} placeholder="Sua senha de acesso" className={fieldClass} disabled={!configured || pending} />
      <FormError error={state.error} />
      <button type="submit" disabled={!configured || pending} className={submitClass}>{pending ? <LoaderCircle className="animate-spin" size={17} /> : null}{pending ? "Entrando…" : "Entrar na plataforma"}{!pending && <ArrowRight size={17} />}</button>
    </form>
  );
}

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPasswordAction, { error: null });
  return <form action={action} className="mt-7">
    <label htmlFor="password" className="text-sm font-medium text-slate-300">Nova senha</label>
    <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={fieldClass} disabled={pending} aria-describedby="password-hint" />
    <p id="password-hint" className="mt-2 text-xs text-slate-500">Use pelo menos 8 caracteres.</p>
    <label htmlFor="confirmation" className="mt-5 block text-sm font-medium text-slate-300">Confirme a senha</label>
    <input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={8} maxLength={128} className={fieldClass} disabled={pending} />
    <FormError error={state.error} />
    <button type="submit" disabled={pending} className={submitClass}>{pending ? "Salvando…" : "Salvar senha e continuar"}<ArrowRight size={17} /></button>
  </form>;
}

export function InvitationForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, { error: null });
  return <form action={action}>
    <input type="hidden" name="token" value={token} />
    <FormError error={state.error} />
    <button type="submit" disabled={pending} className={submitClass}>{pending ? "Confirmando convite…" : "Aceitar convite"}<ArrowRight size={17} /></button>
  </form>;
}

