import type { ReactNode } from "react";
import Link from "next/link";
import { CreditCard, LogOut, Plug, ScrollText, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import { AdminNav } from "./admin-nav";
import { logoutAction } from "@/modules/auth/actions";
import { platformRoleLabels, type PlatformOperator } from "./access";

// Módulos já funcionais ficam em admin-nav.tsx; os demais entram progressivamente e aparecem desativados.
const MODULES = [
  { label: "Assinaturas e pagamentos", icon: CreditCard },
  { label: "Integrações", icon: Plug },
  { label: "IA e consumo", icon: Sparkles },
  { label: "Auditoria", icon: ScrollText },
  { label: "Configurações globais", icon: Settings2 },
] as const;

export function AdminShell({ operator, children }: { operator: PlatformOperator; children: ReactNode }) {
  return <div className="min-h-dvh bg-[var(--bg)] text-[var(--text)]">
    <div role="note" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-[var(--warn)]/30 bg-[var(--warn-bg)] px-4 py-2 text-center text-xs font-medium text-[var(--warn)]">
      <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.14em]"><ShieldCheck size={14} aria-hidden="true" />Super Admin</span>
      <span>Administração global da plataforma. Não é o painel de uma organização.</span>
    </div>
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-6">
      <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:self-start">
        <Link href="/admin" className="text-lg font-semibold tracking-tight">Groow Ads<span className="ml-1.5 font-normal text-[var(--muted)]">Admin</span></Link>
        <nav aria-label="Módulos do Super Admin" className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          <AdminNav />
          {MODULES.map(({ label, icon: Icon }) => <span key={label} aria-disabled="true" title="Disponível em uma próxima etapa" className="flex shrink-0 cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[var(--subtle)]"><Icon size={16} aria-hidden="true" />{label}<span className="ml-auto hidden rounded-full border border-[var(--border)] px-1.5 text-[10px] uppercase tracking-wide lg:inline">Em breve</span></span>)}
        </nav>
        <div className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
          <p className="truncate font-medium text-[var(--text)]" title={operator.email}>{operator.email}</p>
          <p className="mt-0.5 text-[var(--muted)]">{platformRoleLabels[operator.role]}</p>
          <form action={logoutAction} className="mt-3"><button type="submit" className="inline-flex items-center gap-1.5 text-[var(--secondary)] hover:text-[var(--text)]"><LogOut size={14} aria-hidden="true" />Sair</button></form>
        </div>
      </aside>
      <main className="min-w-0">{children}</main>
    </div>
  </div>;
}
