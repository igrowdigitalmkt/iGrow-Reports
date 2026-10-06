"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CircleCheck, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { acceptInvitationAction, createOwnWorkspaceAction, googleSignInAction, loginAction, requestPasswordResetAction, setPasswordAction, signUpAction } from "./actions";

const fieldClass = "mt-2 w-full rounded-xl border border-white/10 bg-[#0c111b] px-4 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50";
const submitClass = "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:opacity-45";

function FormError({ error }: { error: string | null }) {
  return <div aria-live="polite">{error && <p role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}</div>;
}

function PasswordInput({ id, name, autoComplete, placeholder, disabled, minLength }: { id: string; name: string; autoComplete: string; placeholder?: string; disabled?: boolean; minLength?: number }) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <input id={id} name={name} type={visible ? "text" : "password"} autoComplete={autoComplete} required minLength={minLength} maxLength={256} placeholder={placeholder} className={`${fieldClass} pr-11`} disabled={disabled} />
    <button type="button" onClick={() => setVisible(value => !value)} className="absolute right-3 top-1/2 mt-1 -translate-y-1/2 rounded-md p-1 text-slate-500 hover:text-slate-200" aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>
  </div>;
}

function GoogleIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>;
}

/** "Entrar com Google" with the "ou" divider above it. */
export function GoogleButton({ configured, next = "/dashboard", label = "Entrar com Google" }: { configured: boolean; next?: string; label?: string }) {
  return <form action={googleSignInAction} className="mt-5">
    <input type="hidden" name="next" value={next} />
    <div className="flex items-center gap-3 text-xs text-slate-500" aria-hidden="true"><span className="h-px flex-1 bg-white/10" />ou<span className="h-px flex-1 bg-white/10" /></div>
    <button type="submit" disabled={!configured} className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/[0.07] disabled:opacity-45"><GoogleIcon />{label}</button>
  </form>;
}

export function LoginForm({ configured, next }: { configured: boolean; next: string }) {
  const [state, action, pending] = useActionState(loginAction, { error: null });
  return (
    <form action={action} className="mt-7">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="block text-sm font-medium text-slate-300"><Mail size={14} className="mr-2 inline" />E-mail</label>
      <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} placeholder="Seu e-mail" className={fieldClass} disabled={!configured || pending} />
      <label htmlFor="password" className="mt-5 block text-sm font-medium text-slate-300"><LockKeyhole size={14} className="mr-2 inline" />Senha</label>
      <PasswordInput id="password" name="password" autoComplete="current-password" placeholder="Sua senha" disabled={!configured || pending} />
      <div className="mt-2 text-right"><Link href="/recuperar-senha" className="auth-link text-xs">Esqueceu a senha?</Link></div>
      <FormError error={state.error} />
      <button type="submit" disabled={!configured || pending} className={`${submitClass} !mt-4`}>{pending ? <LoaderCircle className="animate-spin" size={17} /> : null}{pending ? "Entrando…" : "Entrar na plataforma"}{!pending && <ArrowRight size={17} />}</button>
    </form>
  );
}

export function ForgotPasswordForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, { error: null, sent: null });
  const [again, setAgain] = useState(false);
  if (state.sent && !again) return <div className="mt-2" role="status">
    <CircleCheck size={28} className="text-emerald-400" />
    <h2 className="mt-4 text-xl font-semibold tracking-tight">E-mail enviado</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Se houver uma conta com <span className="text-slate-200">{state.sent}</span>, enviamos um link para redefinir a senha. Verifique a caixa de entrada e a pasta de spam.</p>
    <div className="mt-6 flex flex-col items-center gap-3 text-sm">
      <button type="button" onClick={() => setAgain(true)} className="text-slate-400 hover:text-white">Usar outro e-mail</button>
      <Link href="/entrar" className="auth-muted-link">Voltar ao login</Link>
    </div>
  </div>;
  return <form action={formData => { setAgain(false); action(formData); }} className="mt-7">
    <label htmlFor="email" className="block text-sm font-medium text-slate-300"><Mail size={14} className="mr-2 inline" />E-mail</label>
    <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} placeholder="Seu e-mail" className={fieldClass} disabled={!configured || pending} />
    <FormError error={state.error} />
    <button type="submit" disabled={!configured || pending} className={submitClass}>{pending ? <LoaderCircle className="animate-spin" size={17} /> : null}{pending ? "Enviando…" : "Enviar link"}</button>
    <p className="mt-5 text-center text-sm"><Link href="/entrar" className="auth-muted-link">Voltar ao login</Link></p>
  </form>;
}

export function SignUpForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(signUpAction, { error: null, sent: null });
  if (state.sent) return <div className="mt-2" role="status">
    <CircleCheck size={28} className="text-emerald-400" />
    <h2 className="mt-4 text-xl font-semibold tracking-tight">Confirme seu e-mail</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Enviamos um link de confirmação para <span className="text-slate-200">{state.sent}</span>. Abra o e-mail e clique no link para ativar a conta e criar seu espaço de trabalho. Confira também a pasta de spam.</p>
    <p className="mt-6 text-center text-sm"><Link href="/entrar" className="auth-muted-link">Voltar ao login</Link></p>
  </div>;
  return <form action={action} className="mt-7">
    <label htmlFor="name" className="block text-sm font-medium text-slate-300"><UserRound size={14} className="mr-2 inline" />Seu nome</label>
    <input id="name" name="name" autoComplete="name" required maxLength={120} placeholder="Seu nome" className={fieldClass} disabled={!configured || pending} />
    <label htmlFor="agency" className="mt-5 block text-sm font-medium text-slate-300"><Building2 size={14} className="mr-2 inline" />Nome da agência</label>
    <input id="agency" name="agency" autoComplete="organization" required maxLength={120} placeholder="Ex.: iGrow Digital" className={fieldClass} disabled={!configured || pending} />
    <label htmlFor="email" className="mt-5 block text-sm font-medium text-slate-300"><Mail size={14} className="mr-2 inline" />E-mail</label>
    <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} placeholder="Seu e-mail" className={fieldClass} disabled={!configured || pending} />
    <label htmlFor="password" className="mt-5 block text-sm font-medium text-slate-300"><LockKeyhole size={14} className="mr-2 inline" />Senha</label>
    <PasswordInput id="password" name="password" autoComplete="new-password" placeholder="Pelo menos 8 caracteres" minLength={8} disabled={!configured || pending} />
    <FormError error={state.error} />
    <button type="submit" disabled={!configured || pending} className={submitClass}>{pending ? <LoaderCircle className="animate-spin" size={17} /> : null}{pending ? "Criando conta…" : "Criar conta"}{!pending && <ArrowRight size={17} />}</button>
  </form>;
}

export function CreateWorkspaceForm({ suggestion }: { suggestion: string }) {
  const [state, action, pending] = useActionState(createOwnWorkspaceAction, { error: null });
  return <form action={action} className="mt-7">
    <label htmlFor="agency" className="block text-sm font-medium text-slate-300"><Building2 size={14} className="mr-2 inline" />Nome da agência</label>
    <input id="agency" name="agency" autoComplete="organization" required maxLength={120} defaultValue={suggestion} placeholder="Ex.: iGrow Digital" className={fieldClass} disabled={pending} />
    <FormError error={state.error} />
    <button type="submit" disabled={pending} className={submitClass}>{pending ? <LoaderCircle className="animate-spin" size={17} /> : null}{pending ? "Criando…" : "Criar espaço de trabalho"}{!pending && <ArrowRight size={17} />}</button>
  </form>;
}

export function SetPasswordForm({ next = "/dashboard" }: { next?: string }) {
  const [state, action, pending] = useActionState(setPasswordAction, { error: null });
  return <form action={action} className="mt-7">
    <input type="hidden" name="next" value={next} />
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
