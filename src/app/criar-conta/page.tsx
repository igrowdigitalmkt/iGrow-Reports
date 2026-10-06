import Link from "next/link";
import type { Metadata } from "next";
import { getSupabaseConfig } from "@/lib/env";
import { AuthShell } from "@/modules/auth/auth-shell";
import { GoogleButton, SignUpForm } from "@/modules/auth/auth-forms";

export const metadata: Metadata = { title: "Criar conta", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function SignUpPage() {
  const configured = Boolean(getSupabaseConfig());
  return <AuthShell>
    <p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-400">Nova conta</p>
    <h2 className="mt-3 text-2xl font-semibold tracking-tight">Crie sua conta</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Comece a acompanhar e enviar os resultados dos seus clientes.</p>
    <SignUpForm configured={configured} />
    <GoogleButton configured={configured} next="/criar-espaco" label="Criar conta com Google" />
    <p className="mt-6 text-center text-sm text-slate-400">Já tem conta? <Link href="/entrar" className="auth-link">Entrar</Link></p>
  </AuthShell>;
}
