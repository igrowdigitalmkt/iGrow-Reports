import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { discardDraftAction, saveDraftAction, startDraftAction, updatePlanAction } from "@/modules/platform-admin/commercial/actions";
import { ActionForm, Field, inputClass, LimitRow, primaryButton, secondaryButton, SubmitButton } from "@/modules/platform-admin/commercial/action-form";
import { centsToInput, describeEntitlement, formatBrl, planDetailSchema, USD_LIMIT_KEYS, type PlanVersion } from "@/modules/platform-admin/commercial/format";
import { Select } from "@/components/ui/select";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plano" };

const STATUS_LABELS = { draft: "Rascunho", published: "Atual", retired: "Substituída" } as const;

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { supabase } = await requirePlatformOperator();
  const [{ data: raw, error }, { data: defs }] = await Promise.all([supabase.rpc("platform_get_plan", { p_plan_id: id }), supabase.rpc("platform_list_definitions")]);
  const parsed = planDetailSchema.safeParse(raw);
  if (error || !parsed.success) notFound();
  const { plan, versions } = parsed.data;
  const draft = versions.find((version) => version.status === "draft");
  const current = versions.find((version) => version.id === plan.current_version_id);
  const definitions = defs ?? [];

  return <div className="space-y-6">
    <header>
      <Link href="/admin/planos" className="text-xs text-[var(--blue)] hover:underline">← Planos</Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{plan.name}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Identificador: <code>{plan.key}</code> · {plan.visibility === "public" ? "Público" : "Privado"} · {plan.sellable ? "Disponível para contratação" : "Não vendido"}</p>
    </header>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="dados">
      <h2 id="dados" className="text-sm font-semibold">Dados do plano</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Texto e vitrine do plano. Mudar aqui vale na hora e não altera preços nem limites de ninguém.</p>
      <ActionForm action={updatePlanAction} className="mt-4 grid gap-4 sm:grid-cols-2">
        <>
          <input type="hidden" name="planId" value={plan.id} />
          <Field label="Nome"><input name="name" defaultValue={plan.name} required minLength={2} maxLength={80} className={inputClass} /></Field>
          <Field label="Visibilidade" hint="Efeito: público/privado define se o plano poderá aparecer na página de vendas (etapa futura)."><Select name="visibility" defaultValue={plan.visibility} className={inputClass}><option value="private">Privado</option><option value="public">Público</option></Select></Field>
          <div className="sm:col-span-2"><Field label="Descrição comercial"><textarea name="description" defaultValue={plan.description} rows={2} maxLength={500} className={inputClass} /></Field></div>
          <Field label="Ordem de apresentação" hint="Menor número aparece primeiro (usado na página de vendas, etapa futura)."><input name="sortOrder" defaultValue={plan.sort_order} inputMode="numeric" className={inputClass} /></Field>
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2"><input type="checkbox" name="sellable" defaultChecked={plan.sellable} className="mt-1" /><span><span className="font-medium">Disponível para contratação</span><span className="block text-xs text-[var(--muted)]">Exige uma versão publicada com preço. A cobrança só passa a existir quando o pagamento for integrado.</span></span></label>
            <label className="flex items-start gap-2"><input type="checkbox" name="recommended" defaultChecked={plan.recommended} className="mt-1" /><span><span className="font-medium">Destacar como recomendado</span><span className="block text-xs text-[var(--muted)]">Usado na página de vendas (etapa futura).</span></span></label>
          </div>
          <div className="sm:col-span-2"><SubmitButton className={primaryButton}>Salvar dados do plano</SubmitButton></div>
        </>
      </ActionForm>
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="condicoes">
      <h2 id="condicoes" className="text-sm font-semibold">Condições comerciais{draft ? ` — rascunho da versão ${draft.version}` : current ? ` — versão ${current.version} (atual)` : ""}</h2>
      {draft ? <>
        <p className="mt-1 text-xs text-[var(--muted)]">{current ? `Cópia da versão ${current.version}. ` : "Primeira versão do plano. "}O rascunho não afeta ninguém até ser publicado. Ao publicar, a versão anterior fica preservada para quem já a usa.</p>
        <ActionForm action={saveDraftAction} className="mt-4 space-y-5">
          <>
            <input type="hidden" name="planId" value={plan.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Preço mensal (R$)" hint="Vazio = ciclo não oferecido."><input name="priceMonthly" defaultValue={centsToInput(draft.price_monthly_cents)} inputMode="decimal" placeholder="0,00" className={inputClass} /></Field>
              <Field label="Preço anual (R$)" hint="Cobrança única por ano."><input name="priceYearly" defaultValue={centsToInput(draft.price_yearly_cents)} inputMode="decimal" placeholder="0,00" className={inputClass} /></Field>
              <Field label="Teste gratuito (dias)" hint="0 a 90. Registrado na versão; será aplicado quando o cadastro com teste for ativado."><input name="trialDays" defaultValue={draft.trial_days} inputMode="numeric" className={inputClass} /></Field>
            </div>
            <div>
              <h3 className="text-sm font-medium">Funcionalidades</h3>
              <div className="mt-2 divide-y divide-[var(--border)]">{definitions.filter((def) => def.kind === "feature").map((def) => <label key={def.key} className="flex items-start gap-3 py-2.5 text-sm">
                <input type="checkbox" name={`ent_${def.key}`} defaultChecked={draft.entitlements.some((item) => item.key === def.key && item.enabled)} className="mt-1" />
                <span><span className="font-medium">{def.label}</span><span className="block text-xs text-[var(--muted)]">{def.description}</span></span></label>)}</div>
            </div>
            <div>
              <h3 className="text-sm font-medium">Limites de utilização</h3>
              <p className="text-xs text-[var(--muted)]">Aplicados no servidor e no banco: novas adições acima do limite são recusadas; nada existente é removido.</p>
              <div className="mt-2 divide-y divide-[var(--border)]">{definitions.filter((def) => def.kind === "limit").map((def) => {
                const item = draft.entitlements.find((entry) => entry.key === def.key);
                const usd = USD_LIMIT_KEYS.has(def.key);
                return <LimitRow key={def.key} name={def.key} label={def.label} unit={usd ? "Teto de gasto em dólares por mês" : def.unit} prefix={usd ? "US$" : undefined}
                  initialMode={item?.unlimited ? "unlimited" : item?.limit != null ? "limit" : "none"} initialValue={item?.limit != null ? (usd ? centsToInput(item.limit) : String(item.limit)) : ""} />;
              })}</div>
            </div>
            <div className="flex flex-wrap gap-3">
              <SubmitButton name="intent" value="save" className={secondaryButton}>Salvar rascunho</SubmitButton>
              <SubmitButton name="intent" value="publish" className={primaryButton}>Salvar e publicar versão {draft.version}</SubmitButton>
            </div>
          </>
        </ActionForm>
        {current && <ActionForm action={discardDraftAction} className="mt-3"><><input type="hidden" name="planId" value={plan.id} /><SubmitButton className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]">Descartar este rascunho</SubmitButton></></ActionForm>}
      </> : current ? <>
        <VersionSummary version={current} definitions={definitions} />
        <ActionForm action={startDraftAction} className="mt-4"><><input type="hidden" name="planId" value={plan.id} /><SubmitButton className={secondaryButton}>Criar nova versão para editar</SubmitButton>
          <p className="mt-2 text-xs text-[var(--muted)]">Versões publicadas não podem ser alteradas. A nova versão começa como cópia desta.</p></></ActionForm>
      </> : <p className="mt-3 text-sm text-[var(--muted)]">Este plano ainda não tem versão.</p>}
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="versoes">
      <h2 id="versoes" className="text-sm font-semibold">Histórico de versões</h2>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Versão</th><th className="py-1.5 pr-3 font-medium">Situação</th><th className="py-1.5 pr-3 font-medium">Mensal</th><th className="py-1.5 pr-3 font-medium">Anual</th><th className="py-1.5 pr-3 font-medium">Teste</th><th className="py-1.5 font-medium">Organizações usando</th></tr></thead>
        <tbody className="divide-y divide-[var(--border)]">{versions.map((version) => <tr key={version.id}><td className="py-2 pr-3">v{version.version}</td><td className="py-2 pr-3">{STATUS_LABELS[version.status]}</td><td className="py-2 pr-3">{formatBrl(version.price_monthly_cents)}</td><td className="py-2 pr-3">{formatBrl(version.price_yearly_cents)}</td><td className="py-2 pr-3">{version.trial_days ? `${version.trial_days} dias` : "Sem teste"}</td><td className="py-2">{version.assigned_orgs}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}

function VersionSummary({ version, definitions }: { version: PlanVersion; definitions: { key: string; kind: string; label: string }[] }) {
  return <div className="mt-3 space-y-3 text-sm">
    <p>Mensal: <strong>{formatBrl(version.price_monthly_cents)}</strong> · Anual: <strong>{formatBrl(version.price_yearly_cents)}</strong> · Teste: <strong>{version.trial_days ? `${version.trial_days} dias` : "sem teste"}</strong></p>
    <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">{definitions.map((def) => {
      const item = version.entitlements.find((entry) => entry.key === def.key);
      return <li key={def.key} className="flex justify-between gap-3 border-b border-[var(--border)] py-1"><span>{def.label}</span><span className={item ? "" : "text-[var(--muted)]"}>{describeEntitlement({ kind: def.kind, key: def.key, enabled: Boolean(item?.enabled), limit_value: item?.limit ?? null, unlimited: Boolean(item?.unlimited) })}</span></li>;
    })}</ul>
  </div>;
}
