import Link from "next/link";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { updateBillingSettingsAction } from "@/modules/platform-admin/commercial/actions";
import { ActionForm, Field, inputClass, primaryButton, SubmitButton } from "@/modules/platform-admin/commercial/action-form";
import { adminRpc, billingDashboardSchema, billingSettingsSchema, ENTITLEMENT_LABELS, limitOf } from "@/modules/platform-admin/commercial/billing-settings";
import { formatUsdFromCents, planDetailSchema } from "@/modules/platform-admin/commercial/format";
import { resolveBillingEnvironment } from "@/modules/billing/credentials";
import { Select } from "@/components/ui/select";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurações comerciais" };

const card = "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5";
const usd = (cents: number | string) => (typeof cents === "string" ? cents : formatUsdFromCents(cents));

export default async function CommercialSettingsPage() {
  const { supabase } = await requirePlatformOperator();
  const rpc = adminRpc(supabase);
  const environment = await resolveBillingEnvironment();
  const [settingsResult, plansResult, dashboardResult] = await Promise.all([
    rpc("platform_get_billing_settings"), rpc("platform_list_plans"), rpc("platform_billing_dashboard", { p_environment: environment }),
  ]);
  const settings = billingSettingsSchema.safeParse(settingsResult.data);
  const dashboard = billingDashboardSchema.safeParse(dashboardResult.data);
  const planList = (Array.isArray(plansResult.data) ? plansResult.data : []) as { plan_id: string; name: string; visibility: string; sellable: boolean; recommended: boolean; current_version_id: string | null }[];
  const details = (await Promise.all(planList.filter(plan => plan.current_version_id).map(async plan => {
    const parsed = planDetailSchema.safeParse((await rpc("platform_get_plan", { p_plan_id: plan.plan_id })).data);
    const version = parsed.success ? parsed.data.versions.find(item => item.id === plan.current_version_id) : undefined;
    return version ? { plan, version } : null;
  }))).filter((item): item is NonNullable<typeof item> => item !== null);

  if (!settings.success) return <div className="space-y-6"><h1 className="text-2xl font-semibold tracking-tight">Configurações comerciais</h1>
    <p role="alert" className="text-sm text-[var(--bad)]">Não foi possível carregar as configurações agora. Confira se a migration das configurações comerciais já foi aplicada neste ambiente.</p></div>;
  const s = settings.data;
  const trialLimits = s.trial_plan?.entitlements ?? [];

  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Configurações comerciais</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--secondary)]">Teste gratuito, regras de assinatura, limites de IA e WhatsApp. Planos, preços e limites são editados em <Link href="/admin/planos" className="text-[var(--blue)] hover:underline">Planos</Link>; aqui você só vê o resumo e acessa a edição.</p>
      <p className="mt-2 text-xs text-[var(--muted)]">Cobrança real (live_enabled): <strong className={s.live_enabled ? "text-[var(--warn)]" : "text-[var(--good)]"}>{s.live_enabled ? "ligada" : "desligada"}</strong> · indicador apenas; não é alterado por esta tela. Ambiente do Asaas: {environment === "production" ? "produção" : "Sandbox (testes)"}.</p>
    </header>

    <ActionForm action={updateBillingSettingsAction} className="space-y-6">
      <>
        <section className={card} aria-labelledby="trial">
          <h2 id="trial" className="text-sm font-semibold">A. Teste gratuito</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Sem cartão e sem checkout. Mudanças valem só para novos testes: os já iniciados mantêm plano e vencimento. Sem plano de teste, o cadastro novo nasce com acesso restrito (nunca ilimitado).</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Duração do teste (dias)" hint="De 1 a 90."><input name="trialDays" type="number" min={1} max={90} defaultValue={s.trial_days} required className={inputClass} /></Field>
            <Field label="Plano usado no teste" hint="Só planos privados e não vendáveis, em versão publicada.">
              <Select name="trialPlanVersionId" defaultValue={s.trial_plan_version_id ?? ""} className={inputClass}>
                <option value="">Sem teste gratuito (cadastros novos nascem restritos)</option>
                {s.trial_candidates.map(item => <option key={item.version_id} value={item.version_id}>{item.label}</option>)}
              </Select>
            </Field>
          </div>
          {s.trial_plan ? <div className="mt-4">
            <p className="text-xs font-medium text-[var(--secondary)]">Limites do teste ({s.trial_plan.plan_name}, versão {s.trial_plan.version})</p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {["clients", "ad_accounts", "team_members", "whatsapp_numbers", "report_automations", "ai_budget_usd_cents"].map(key => <li key={key} className="flex justify-between gap-3 border-b border-[var(--border)] py-1">
                <span className="text-[var(--secondary)]">{ENTITLEMENT_LABELS[key]}</span>
                <span>{key === "ai_budget_usd_cents" ? (() => { const v = limitOf(trialLimits, key); return typeof v === "number" ? usd(v) : v; })() : limitOf(trialLimits, key)}</span></li>)}
            </ul>
            <p className="mt-2 text-xs"><Link href={`/admin/planos/${s.trial_plan.plan_id}`} className="text-[var(--blue)] hover:underline">Editar limites e recursos do plano de teste</Link> (o orçamento de IA do teste é o limite acima).</p>
          </div> : <p className="mt-4 text-sm text-[var(--warn)]">Nenhum plano de teste configurado: novos cadastros nascem com acesso restrito até que um seja escolhido.</p>}
        </section>

        <section className={card} aria-labelledby="regras">
          <h2 id="regras" className="text-sm font-semibold">B. Regras de assinatura</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Valem para novas ocorrências. Assinaturas, períodos pagos, tolerâncias e checkouts já gravados não mudam. Pagamentos continuam confirmados somente pelo Asaas.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Tolerância por inadimplência (dias)" hint="De 0 a 60. Hoje: acesso mantido por este prazo após o vencimento."><input name="graceDays" type="number" min={0} max={60} defaultValue={s.past_due_grace_days} required className={inputClass} /></Field>
            <Field label="Validade do checkout (minutos)" hint="De 10 a 1440."><input name="checkoutMinutes" type="number" min={10} max={1440} defaultValue={s.checkout_minutes} required className={inputClass} /></Field>
          </div>
        </section>
        <div><SubmitButton className={primaryButton}>Salvar configurações</SubmitButton></div>
      </>
    </ActionForm>

    <section className={card} aria-labelledby="ia">
      <h2 id="ia" className="text-sm font-semibold">C. Inteligência artificial</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">O orçamento mensal vem do plano e é o teto: a configuração de uma organização nunca o ultrapassa. Para alterar, publique uma nova versão do plano.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[28rem] text-left text-sm"><thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Plano (versão atual)</th><th className="py-1.5 pr-3 font-medium">Orçamento mensal de IA</th><th className="py-1.5 font-medium">Edição</th></tr></thead>
        <tbody className="divide-y divide-[var(--border)]">{details.map(({ plan, version }) => { const v = limitOf(version.entitlements, "ai_budget_usd_cents"); return <tr key={plan.plan_id}>
          <td className="py-2.5 pr-3">{plan.name}{plan.recommended && <span className="ml-2 text-xs text-[var(--good)]">Recomendado</span>}<span className="ml-2 text-xs text-[var(--muted)]">v{version.version}</span></td>
          <td className="py-2.5 pr-3">{typeof v === "number" ? (v > 0 ? `até ${usd(v)} por mês` : "Sem IA") : "Ilimitado"}</td>
          <td className="py-2.5"><Link href={`/admin/planos/${plan.plan_id}`} className="text-[var(--blue)] hover:underline">Editar plano</Link></td></tr>; })}</tbody></table></div>
      {dashboard.success && <p className="mt-3 text-xs text-[var(--secondary)]">Consumo de IA neste mês (todas as organizações): <strong>{usd(Math.round(dashboard.data.ai.month_cost_usd * 100))}</strong> em {dashboard.data.ai.organizations_with_usage} organização(ões).</p>}
    </section>

    <section className={card} aria-labelledby="whats">
      <h2 id="whats" className="text-sm font-semibold">D. WhatsApp</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Duas conexões distintas: a conexão por <strong>QR Code</strong> (uma por organização, incluída em todos os planos, fora do limite) e os <strong>números oficiais</strong> da API (limite do plano). O QR Code não consome o limite de números oficiais.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[28rem] text-left text-sm"><thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Plano</th><th className="py-1.5 pr-3 font-medium">Conexão por QR Code</th><th className="py-1.5 pr-3 font-medium">Números oficiais</th><th className="py-1.5 font-medium">Edição</th></tr></thead>
        <tbody className="divide-y divide-[var(--border)]">{details.map(({ plan, version }) => <tr key={plan.plan_id}><td className="py-2.5 pr-3">{plan.name}</td><td className="py-2.5 pr-3">1 incluída</td>
          <td className="py-2.5 pr-3">{limitOf(version.entitlements, "whatsapp_numbers") || "nenhum"}</td>
          <td className="py-2.5"><Link href={`/admin/planos/${plan.plan_id}`} className="text-[var(--blue)] hover:underline">Editar plano</Link></td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
