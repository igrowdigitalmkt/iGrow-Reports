import Link from "next/link";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { createPlanAction } from "@/modules/platform-admin/commercial/actions";
import { ActionForm, Field, inputClass, primaryButton, SubmitButton } from "@/modules/platform-admin/commercial/action-form";
import { formatBrl } from "@/modules/platform-admin/commercial/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planos" };

export default async function PlansPage() {
  const { supabase } = await requirePlatformOperator();
  const { data: plans, error } = await supabase.rpc("platform_list_plans");
  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Planos</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--secondary)]">Catálogo comercial do Groow Ads. Cada plano tem versões: uma versão publicada nunca muda, então alterar preços ou limites cria uma nova versão e quem já usa a anterior continua com as condições dela. Nenhuma cobrança é criada nesta etapa.</p>
    </header>
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="lista">
      <h2 id="lista" className="text-sm font-semibold">Planos cadastrados</h2>
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--bad)]">Não foi possível carregar os planos agora.</p>
        : !plans?.length ? <p className="mt-3 text-sm text-[var(--muted)]">Nenhum plano ainda. Crie o primeiro abaixo; os planos oficiais são definidos por você.</p>
        : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Plano</th><th className="py-1.5 pr-3 font-medium">Versão</th><th className="py-1.5 pr-3 font-medium">Mensal</th><th className="py-1.5 pr-3 font-medium">Anual</th><th className="py-1.5 pr-3 font-medium">Visibilidade</th><th className="py-1.5 pr-3 font-medium">Situação</th><th className="py-1.5 font-medium">Organizações</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">{plans.map((plan) => <tr key={plan.plan_id}>
            <td className="py-2.5 pr-3"><Link href={`/admin/planos/${plan.plan_id}`} className="font-medium text-[var(--blue)] hover:underline">{plan.name}</Link>{plan.recommended && <span className="ml-2 rounded-full border border-[var(--accent)]/40 px-1.5 text-[10px] uppercase text-[var(--blue)]">Recomendado</span>}<span className="block text-xs text-[var(--muted)]">{plan.key}</span></td>
            <td className="py-2.5 pr-3">{plan.current_version ? `v${plan.current_version}` : <span className="text-[var(--warn)]">não publicada</span>}{plan.has_draft && <span className="block text-xs text-[var(--muted)]">com rascunho</span>}</td>
            <td className="py-2.5 pr-3">{plan.current_version ? formatBrl(plan.price_monthly_cents) : "—"}</td>
            <td className="py-2.5 pr-3">{plan.current_version ? formatBrl(plan.price_yearly_cents) : "—"}</td>
            <td className="py-2.5 pr-3">{plan.visibility === "public" ? "Público" : "Privado"}</td>
            <td className="py-2.5 pr-3">{plan.sellable ? "Disponível para contratação" : "Não vendido"}</td>
            <td className="py-2.5">{plan.assigned_orgs}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="novo">
      <h2 id="novo" className="text-sm font-semibold">Novo plano</h2>
      <ActionForm action={createPlanAction} className="mt-3 grid gap-4 sm:grid-cols-2">
        <>
          <Field label="Nome" hint="Como o plano aparece para o cliente."><input name="name" required minLength={2} maxLength={80} className={inputClass} /></Field>
          <Field label="Identificador" hint="Letras minúsculas, números, - ou _. Não pode ser mudado depois."><input name="key" required pattern="[a-z][a-z0-9_\-]{1,39}" maxLength={40} className={inputClass} /></Field>
          <div className="sm:col-span-2"><Field label="Descrição comercial"><textarea name="description" rows={2} maxLength={500} className={inputClass} /></Field></div>
          <Field label="Visibilidade" hint="Público aparecerá na página de vendas (etapa futura). Privado só por convite ou atribuição."><select name="visibility" defaultValue="private" className={inputClass}><option value="private">Privado</option><option value="public">Público</option></select></Field>
          <div className="flex items-end"><SubmitButton className={primaryButton}>Criar plano e abrir</SubmitButton></div>
        </>
      </ActionForm>
    </section>
  </div>;
}
