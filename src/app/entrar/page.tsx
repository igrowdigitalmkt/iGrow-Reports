import Link from "next/link";
import { ArrowUpRight, Settings2 } from "lucide-react";
import type { Metadata } from "next";
import { getSupabaseConfig, isDemoEnabled } from "@/lib/env";
import { AuthShell } from "@/modules/auth/auth-shell";
import { LoginForm } from "@/modules/auth/auth-forms";
import { safeRedirect } from "@/modules/auth/redirect";
import { LinkSessionHandler } from "@/modules/auth/link-session-handler";

export const metadata: Metadata = { title: "Entrar", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erro?: string }> }) {
  const params = await searchParams;
  const configured = Boolean(getSupabaseConfig());
  return <AuthShell>
    <p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-400">Seu espaço de trabalho</p>
    <h2 className="mt-3 text-2xl font-semibold tracking-tight">Bem-vindo de volta</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Entre para acessar os resultados e ambientes liberados para a sua conta.</p>
    {!configured && <div role="status" className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm"><p className="flex items-center gap-2 font-medium text-amber-200"><Settings2 size={16} />Não configurado</p><p className="mt-2 leading-6 text-slate-400">A autenticação ainda precisa ser conectada ao Supabase. O responsável pelo ambiente deve concluir a configuração.</p></div>}
    {params.erro === "link-invalido" && <p role="alert" className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-200">Este link não é válido ou expirou. Solicite um novo convite ao responsável.</p>}
    <LinkSessionHandler />
    <LoginForm configured={configured} next={safeRedirect(params.next)} />
    <p className="mt-5 text-center text-xs leading-5 text-slate-500">O acesso é liberado pelo responsável pelo espaço de trabalho.<br />Precisa de ajuda com a senha? Fale com seu administrador.</p>
    {isDemoEnabled() && <div className="mt-7 border-t border-white/10 pt-6"><Link href="/demo" className="flex items-center justify-between gap-3 text-sm font-medium text-cyan-300 hover:text-cyan-200">Explorar demonstração<ArrowUpRight size={17} /></Link><p className="mt-2 text-xs leading-5 text-slate-500">Ambiente separado com dados fictícios e sem envios reais.</p></div>}
  </AuthShell>;
}

