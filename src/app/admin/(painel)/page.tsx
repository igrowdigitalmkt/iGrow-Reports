import Link from "next/link";
import { CheckCircle2, Clock } from "lucide-react";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { platformRoleLabels } from "@/modules/platform-admin/access";

export const dynamic = "force-dynamic";

const MODULES_READY = [
  ["Planos", "/admin/planos", "Catálogo comercial com versões, preços, funcionalidades e limites."],
  ["Recursos e interruptores", "/admin/recursos", "Catálogo dos recursos controláveis e desativação global de emergência."],
  ["Organizações e concessões", "/admin/organizacoes", "Atribuir plano a uma organização e conceder liberações temporárias."],
] as const;

const PLANNED = [
  ["Assinaturas e pagamentos", "Cobrança recorrente automática com o Asaas, webhooks e conciliação."],
  ["Integrações e IA", "Situação das conexões e consumo de inteligência artificial."],
  ["Configurações globais", "Identidade da plataforma e preferências."],
] as const;

const AUDIT_LABELS: Record<string, string> = {
  "admin.mfa_enrolled": "Autenticador cadastrado", "admin.mfa_verified": "Verificação em duas etapas concluída",
  "admin.mfa_failed": "Código de verificação recusado", "platform.owner_provisioned": "Proprietário provisionado",
  "platform.operator_deactivated": "Operador desativado",
  "commercial.plan_created": "Plano criado", "commercial.plan_updated": "Plano atualizado", "commercial.draft_started": "Nova versão de plano iniciada",
  "commercial.draft_saved": "Rascunho de plano salvo", "commercial.draft_discarded": "Rascunho de plano descartado", "commercial.version_published": "Versão de plano publicada",
  "commercial.plan_granted_admin": "Plano concedido administrativamente", "commercial.plan_unassigned": "Plano removido de organização",
  "commercial.override_granted": "Concessão registrada", "commercial.override_revoked": "Concessão revogada",
  "commercial.feature_disabled": "Funcionalidade desativada globalmente", "commercial.feature_enabled": "Funcionalidade reativada globalmente",
};
const OUTCOME_LABELS: Record<string, string> = { success: "Sucesso", denied: "Negado", failure: "Falha" };

export default async function AdminHomePage() {
  const { supabase, operator } = await requirePlatformOperator();
  const { data: events, error } = await supabase.rpc("platform_recent_audit", { p_limit: 10 });
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  return <div className="space-y-6">
    <header>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--blue)]">Super Admin</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Visão geral</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--secondary)]">Base de segurança da administração da plataforma. Os módulos de gestão serão liberados em etapas; nenhum indicador é exibido antes de ter uma fonte real.</p>
    </header>
    <section aria-labelledby="sessao" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 id="sessao" className="text-sm font-semibold">Sessão administrativa</h2>
      <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-[var(--muted)]">Operador</dt><dd className="mt-0.5 break-all">{operator.email}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Papel</dt><dd className="mt-0.5">{platformRoleLabels[operator.role]}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Verificação em duas etapas</dt><dd className="mt-0.5 inline-flex items-center gap-1.5 text-[var(--good)]"><CheckCircle2 size={15} aria-hidden="true" />Validada nesta sessão</dd></div>
      </dl>
      <p className="mt-4 text-xs"><Link href="/admin/mfa" className="text-[var(--blue)] hover:underline">Gerenciar autenticadores</Link></p>
    </section>
    <section aria-labelledby="disponiveis" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 id="disponiveis" className="text-sm font-semibold">Módulos disponíveis</h2>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {MODULES_READY.map(([name, href, text]) => <li key={name} className="py-2.5 text-sm"><Link href={href} className="font-medium text-[var(--blue)] hover:underline">{name}</Link><span className="block text-xs text-[var(--muted)]">{text}</span></li>)}
      </ul>
    </section>
    <section aria-labelledby="modulos" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 id="modulos" className="text-sm font-semibold">Próximos módulos</h2>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {PLANNED.map(([name, text]) => <li key={name} className="flex items-start gap-3 py-2.5 text-sm"><Clock size={15} className="mt-0.5 shrink-0 text-[var(--subtle)]" aria-hidden="true" /><span><span className="font-medium">{name}</span><span className="block text-xs text-[var(--muted)]">{text}</span></span></li>)}
      </ul>
    </section>
    <section aria-labelledby="auditoria" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 id="auditoria" className="text-sm font-semibold">Últimos eventos administrativos</h2>
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--bad)]">Não foi possível carregar a auditoria agora.</p>
        : !events?.length ? <p className="mt-3 text-sm text-[var(--muted)]">Nenhum evento registrado ainda.</p>
        : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Quando</th><th className="py-1.5 pr-3 font-medium">Evento</th><th className="py-1.5 pr-3 font-medium">Operador</th><th className="py-1.5 font-medium">Resultado</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">{events.map((event) => <tr key={event.id}><td className="whitespace-nowrap py-2 pr-3 text-[var(--secondary)]">{when.format(new Date(event.created_at))}</td><td className="py-2 pr-3">{AUDIT_LABELS[event.action] ?? event.action}</td><td className="py-2 pr-3 text-[var(--secondary)]">{event.actor_email ?? "Banco de dados"}</td><td className="py-2">{OUTCOME_LABELS[event.outcome] ?? event.outcome}</td></tr>)}</tbody>
        </table></div>}
    </section>
  </div>;
}
