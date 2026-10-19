import type { Metadata } from "next";
import { AuthShell } from "@/modules/auth/auth-shell";
import { SetPasswordForm } from "@/modules/auth/auth-forms";
import { requireUserSession } from "@/modules/agencies/context";
import { safeRedirect } from "@/modules/auth/redirect";

export const metadata: Metadata = { title: "Definir senha", robots: { index: false, follow: false } };

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireUserSession("/auth/definir-senha");
  const next = safeRedirect((await searchParams).next);
  return <AuthShell><p className="auth-card-kicker">Seu acesso</p><h2 className="mt-3 text-2xl font-semibold">Defina sua senha</h2><p className="mt-3 text-sm leading-6 text-[#aab4cb]">Crie uma senha segura para os próximos acessos à plataforma.</p><SetPasswordForm next={next} /></AuthShell>;
}

