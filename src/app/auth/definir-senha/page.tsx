import type { Metadata } from "next";
import { AuthShell } from "@/modules/auth/auth-shell";
import { SetPasswordForm } from "@/modules/auth/auth-forms";
import { requireUserSession } from "@/modules/agencies/context";

export const metadata: Metadata = { title: "Definir senha", robots: { index: false, follow: false } };

export default async function SetPasswordPage() {
  await requireUserSession("/auth/definir-senha");
  return <AuthShell><p className="text-xs font-medium uppercase tracking-[0.16em] text-blue-400">Acesso da equipe</p><h2 className="mt-3 text-2xl font-semibold">Defina sua senha</h2><p className="mt-3 text-sm leading-6 text-slate-400">Crie uma senha segura para os próximos acessos à plataforma.</p><SetPasswordForm /></AuthShell>;
}

