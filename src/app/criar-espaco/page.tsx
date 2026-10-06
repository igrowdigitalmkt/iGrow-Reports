import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/modules/auth/auth-shell";
import { logoutAction } from "@/modules/auth/actions";
import { CreateWorkspaceForm } from "@/modules/auth/auth-forms";
import { getUserMemberships, requireUserSession } from "@/modules/agencies/context";

export const metadata: Metadata = { title: "Criar espaço de trabalho", robots: { index: false, follow: false } };

// First access after sign-up or Google: people already in a workspace go straight to it.
export default async function CreateWorkspacePage({ searchParams }: { searchParams: Promise<{ novo?: string }> }) {
  const { supabase, user } = await requireUserSession("/criar-espaco");
  const { novo } = await searchParams;
  const memberships = await getUserMemberships(supabase, user.id);
  if (memberships.length > 0 && novo !== "1") redirect("/dashboard");
  const metadata = user.user_metadata as { pending_agency_name?: string | null; full_name?: string | null } | undefined;
  return <AuthShell>
    <p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-400">Último passo</p>
    <h2 className="mt-3 text-2xl font-semibold tracking-tight">Crie seu espaço de trabalho</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">É onde ficam seus clientes, relatórios e envios. Você será o proprietário e poderá convidar sua equipe depois.</p>
    <CreateWorkspaceForm suggestion={metadata?.pending_agency_name ?? ""} />
    <p className="mt-5 text-center text-xs leading-5 text-slate-500">Recebeu um convite de uma agência? Abra o link do convite em vez de criar um espaço novo.</p>
    <form action={logoutAction}><button className="mt-5 w-full text-center text-sm text-slate-400 hover:text-white">Sair e usar outra conta</button></form>
  </AuthShell>;
}
