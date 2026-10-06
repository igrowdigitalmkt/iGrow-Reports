import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/modules/auth/auth-shell";
import { logoutAction } from "@/modules/auth/actions";
import { getUserMemberships, requireUserSession } from "@/modules/agencies/context";
import { getClientPortalAccesses } from "@/modules/client-portal/context";
import { acceptPendingClientInvitations } from "@/modules/client-portal/invitations";

export const metadata: Metadata = { title: "Acesso pendente", robots: { index: false, follow: false } };

export default async function NoAccessPage() {
  const { supabase, user } = await requireUserSession();
  const memberships = await getUserMemberships(supabase, user.id);
  if (memberships.length > 0) redirect("/dashboard");
  // Client portal users have no agency membership; send them to their area.
  await acceptPendingClientInvitations(supabase);
  if ((await getClientPortalAccesses(supabase).catch(() => [])).length > 0) redirect("/cliente");
  return <AuthShell><p className="text-xs font-medium uppercase tracking-[0.16em] text-amber-300">Acesso pendente</p><h2 className="mt-3 text-2xl font-semibold">Falta vincular seu espaço de trabalho</h2><p className="mt-4 text-sm leading-6 text-slate-400">A conta <span className="break-all text-slate-200">{user.email}</span> está autenticada, mas ainda não pertence a nenhum espaço de trabalho. Abra o link de convite ou peça ao responsável para liberar seu acesso.</p><Link href="/criar-espaco" className="mt-7 flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-500">Criar meu próprio espaço de trabalho</Link><form action={logoutAction}><button className="mt-3 w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-medium hover:bg-white/5">Sair e usar outra conta</button></form></AuthShell>;
}

