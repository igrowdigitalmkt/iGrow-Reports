import type { Metadata } from "next";
import { getSupabaseConfig } from "@/lib/env";
import { AuthShell } from "@/modules/auth/auth-shell";
import { ForgotPasswordForm } from "@/modules/auth/auth-forms";

export const metadata: Metadata = { title: "Recuperar senha", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function ForgotPasswordPage() {
  return <AuthShell>
    <h2 className="text-2xl font-semibold tracking-tight">Recuperar senha</h2>
    <p className="mt-2 text-sm leading-6 text-slate-400">Receba um link de recuperação por e-mail.</p>
    <ForgotPasswordForm configured={Boolean(getSupabaseConfig())} />
  </AuthShell>;
}
