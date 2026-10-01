import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/modules/auth/auth-shell";
import { InvitationForm } from "@/modules/auth/auth-forms";
import { invitationTokenSchema } from "@/modules/auth/schemas";
import { logoutAction } from "@/modules/auth/actions";
import { requireUserSession } from "@/modules/agencies/context";

export const metadata: Metadata = { title: "Convite do espaço de trabalho", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  const parsed = invitationTokenSchema.safeParse(params.token);
  if (!parsed.success) return <AuthShell><h2 className="text-2xl font-semibold">Convite inválido</h2><p className="mt-4 text-sm leading-6 text-slate-400">Abra o link completo recebido do responsável pelo espaço de trabalho ou solicite um novo convite.</p><Link href="/entrar" className="mt-6 inline-block text-sm text-blue-400">Voltar para o acesso</Link></AuthShell>;
  const { user } = await requireUserSession(`/convite?token=${parsed.data}`);
  return <AuthShell><p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-400">Você foi convidado</p><h2 className="mt-3 text-2xl font-semibold">Faça parte da equipe</h2><p className="mt-4 text-sm leading-6 text-slate-400">Confirme o convite com a conta <span className="break-all text-slate-200">{user.email}</span>. O acesso será liberado somente se este for o e-mail convidado e o link estiver válido.</p><InvitationForm token={parsed.data} /><form action={logoutAction}><button className="mt-5 text-sm text-slate-400 hover:text-white">Sair para usar outro e-mail</button></form></AuthShell>;
}

