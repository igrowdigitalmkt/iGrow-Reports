import { Building2, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/modules/auth/auth-shell";
import { logoutAction } from "@/modules/auth/actions";
import { requireUserSession, getUserMemberships } from "@/modules/agencies/context";
import { selectAgencyAction } from "@/modules/agencies/actions";
import { roleLabels } from "@/modules/agencies/roles";

export const metadata: Metadata = { title: "Escolher agência", robots: { index: false, follow: false } };

export default async function SelectAgencyPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { supabase, user } = await requireUserSession("/selecionar-agencia");
  const memberships = await getUserMemberships(supabase, user.id);
  if (memberships.length === 0) redirect("/sem-acesso");
  const { erro } = await searchParams;
  return <AuthShell>
    <p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-400">Espaços de trabalho</p>
    <h2 className="mt-3 text-2xl font-semibold">Escolha sua agência</h2>
    <p className="mt-3 text-sm leading-6 text-slate-400">Você está conectado como <span className="break-all text-slate-200">{user.email}</span>.</p>
    {erro && <p role="alert" className="mt-5 text-sm text-rose-300">Não foi possível selecionar esta agência. Escolha um dos acessos disponíveis.</p>}
    <div className="mt-7 space-y-3">{memberships.map(({ agency, role }) => <form action={selectAgencyAction} key={agency.id}>
      <input type="hidden" name="agency_id" value={agency.id} />
      <button className="flex w-full items-center gap-3 rounded-xl border border-white/10 p-4 text-left transition hover:border-blue-400/50 hover:bg-blue-500/5"><span className="rounded-lg bg-blue-500/10 p-2.5 text-blue-400"><Building2 size={20} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{agency.name}</span><span className="mt-1 block text-xs text-slate-400">{roleLabels[role]}</span></span><ChevronRight size={17} className="text-slate-500" /></button>
    </form>)}</div>
    <form action={logoutAction}><button className="mt-7 text-sm text-slate-400 hover:text-white">Sair da conta</button></form>
  </AuthShell>;
}

