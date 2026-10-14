import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePlatformOperatorForMfa } from "@/modules/platform-admin/guard";
import { MfaPanel } from "@/modules/platform-admin/mfa-panel";

export const dynamic = "force-dynamic";

export default async function AdminMfaPage() {
  const { supabase, operator, mfaVerified } = await requirePlatformOperatorForMfa();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verifiedFactorId = factors?.totp[0]?.id;
  return <main className="flex min-h-dvh items-center justify-center bg-[var(--bg)] px-4 py-10 text-[var(--text)]">
    <section className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)] sm:p-8">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--warn)]"><ShieldCheck size={14} aria-hidden="true" />Super Admin</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">{mfaVerified ? "Autenticadores" : verifiedFactorId ? "Verificação em duas etapas" : "Ative a verificação em duas etapas"}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--secondary)]">
        {mfaVerified ? "A verificação desta sessão está concluída. Você pode cadastrar outro aparelho como reserva."
          : verifiedFactorId ? `Conta ${operator.email}. Informe o código do seu aplicativo autenticador para abrir a administração.`
          : `Conta ${operator.email}. O acesso administrativo exige um aplicativo autenticador. Configure agora; é feito uma única vez.`}
      </p>
      {mfaVerified ? <><MfaPanel mode="enroll" addingAnother /><p className="mt-6"><Link href="/admin" className="text-sm text-[var(--blue)] hover:underline">Voltar à visão geral</Link></p></>
        : verifiedFactorId ? <MfaPanel mode="verify" factorId={verifiedFactorId} /> : <MfaPanel mode="enroll" />}
    </section>
  </main>;
}
