import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { assignPlanAction, grantOverrideAction, revokeOverrideAction, unassignPlanAction } from "@/modules/platform-admin/commercial/actions";
import { ActionForm, dangerButton, Field, inputClass, primaryButton, secondaryButton, SubmitButton } from "@/modules/platform-admin/commercial/action-form";
import { assignmentKindDescription, describeEntitlement, SOURCE_LABELS, USD_LIMIT_KEYS, formatUsdFromCents } from "@/modules/platform-admin/commercial/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organização" };

export default async function AgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { supabase } = await requirePlatformOperator();
  const [agencies, plans, entitlements, overrides, definitions] = await Promise.all([
    supabase.rpc("platform_list_agencies", { p_query: id, p_limit: 1 }), supabase.rpc("platform_list_plans"), supabase.rpc("platform_agency_entitlements", { p_agency_id: id }),
    supabase.rpc("platform_list_overrides", { p_agency_id: id }), supabase.rpc("platform_list_definitions"),
  ]);
  const agency = agencies.data?.find((item) => item.agency_id === id);
  if (!agency) notFound();
  const offered = (plans.data ?? []).filter((plan) => plan.current_version_id);
  const managed = Boolean(agency.plan_name);
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
  const fmtUsed = (key: string, value: number | null) => value == null ? "—" : USD_LIMIT_KEYS.has(key) ? formatUsdFromCents(value) : String(value);

  return <div className="space-y-6">
    <header>
      <Link href="/admin/organizacoes" className="text-xs text-[var(--blue)] hover:underline">← Organizações</Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{agency.name}</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">{agency.members} na equipe · {agency.clients} clientes ativos · criada em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(agency.created_at))}</p>
    </header>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="plano">
      <h2 id="plano" className="text-sm font-semibold">Plano da organização</h2>
      <p className="mt-1 text-sm text-[var(--secondary)]">{managed ? <>Plano <strong>{agency.plan_name}</strong> (versão {agency.plan_version}) desde {agency.assigned_at ? when.format(new Date(agency.assigned_at)) : "—"}. <strong>{assignmentKindDescription(agency.assignment_kind)}</strong></> : "Sem plano atribuído: nenhuma restrição comercial. Nada muda para esta organização enquanto ela não receber um plano."}</p>
      {offered.length === 0 ? <p className="mt-3 text-sm text-[var(--warn)]">Nenhum plano publicado ainda. <Link href="/admin/planos" className="underline">Crie e publique um plano</Link> para poder atribuí-lo.</p>
        : <ActionForm action={assignPlanAction} className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <>
            <input type="hidden" name="agencyId" value={agency.agency_id} />
            <Field label={managed ? "Trocar para" : "Conceder plano"} hint="Sempre a versão atual do plano escolhido. Concessão gratuita: não é uma assinatura paga."><select name="versionId" required className={inputClass} defaultValue=""><option value="" disabled>Escolha…</option>{offered.map((plan) => <option key={plan.plan_id} value={plan.current_version_id ?? ""}>{plan.name} (v{plan.current_version})</option>)}</select></Field>
            <Field label="Motivo da concessão" hint="Obrigatório; fica na auditoria."><input name="note" required minLength={3} maxLength={300} placeholder="Ex.: parceiro, cortesia, organização fundadora" className={inputClass} /></Field>
            <SubmitButton className={primaryButton}>{managed ? "Trocar plano" : "Conceder plano"}</SubmitButton>
          </>
        </ActionForm>}
      {managed && <ActionForm action={unassignPlanAction} className="mt-3"><><input type="hidden" name="agencyId" value={agency.agency_id} /><SubmitButton className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]">Remover plano (volta a não ter restrições)</SubmitButton></></ActionForm>}
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="direitos">
      <h2 id="direitos" className="text-sm font-semibold">Direitos em vigor</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Ordem de precedência: desativação global, concessão, plano. As permissões de cada usuário (papel e módulos da equipe) continuam valendo à parte.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[34rem] text-left text-sm">
        <thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Recurso</th><th className="py-1.5 pr-3 font-medium">Direito</th><th className="py-1.5 pr-3 font-medium">Uso atual</th><th className="py-1.5 font-medium">Origem</th></tr></thead>
        <tbody className="divide-y divide-[var(--border)]">{entitlements.data?.map((row) => <tr key={row.key}><td className="py-2 pr-3">{row.label}</td><td className="py-2 pr-3">{describeEntitlement(row)}</td><td className="py-2 pr-3">{row.kind === "limit" ? fmtUsed(row.key, row.used) : "—"}</td><td className="py-2 text-[var(--muted)]">{SOURCE_LABELS[row.source] ?? row.source}</td></tr>)}</tbody></table></div>
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="concessoes">
      <h2 id="concessoes" className="text-sm font-semibold">Concessões administrativas</h2>
      <p className="mt-1 text-xs text-[var(--muted)]">Liberação temporária ou ampliação de limite só para esta organização. Não é cupom nem plano privado: não cobra nem altera o plano. Cada concessão guarda motivo e responsável e só pode ser revogada.</p>
      {overrides.data?.length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Recurso</th><th className="py-1.5 pr-3 font-medium">Valor</th><th className="py-1.5 pr-3 font-medium">Validade</th><th className="py-1.5 pr-3 font-medium">Motivo e responsável</th><th className="py-1.5 pr-3 font-medium">Situação</th><th className="py-1.5" /></tr></thead>
        <tbody className="divide-y divide-[var(--border)]">{overrides.data.map((item) => <tr key={item.id}>
          <td className="py-2 pr-3">{item.label}</td>
          <td className="py-2 pr-3">{item.enabled !== null ? (item.enabled ? "Liberado" : "Bloqueado") : item.unlimited ? "Ilimitado" : `até ${USD_LIMIT_KEYS.has(item.key) ? formatUsdFromCents(item.limit_value ?? 0) : item.limit_value}`}</td>
          <td className="py-2 pr-3">{item.expires_at ? `até ${when.format(new Date(item.expires_at))}` : "Sem prazo"}</td>
          <td className="py-2 pr-3">{item.reason}<span className="block text-xs text-[var(--muted)]">{item.granted_by_email ?? "—"} · {when.format(new Date(item.created_at))}</span></td>
          <td className="py-2 pr-3 capitalize">{item.status}</td>
          <td className="py-2">{item.status === "ativa" || item.status === "agendada" ? <ActionForm action={revokeOverrideAction} className=""><><input type="hidden" name="overrideId" value={item.id} /><SubmitButton className={dangerButton}>Revogar</SubmitButton></></ActionForm> : null}</td></tr>)}</tbody></table></div>
        : <p className="mt-3 text-sm text-[var(--muted)]">Nenhuma concessão registrada.</p>}
      {managed ? <ActionForm action={grantOverrideAction} resetOnSuccess className="mt-5 grid gap-4 border-t border-[var(--border)] pt-5 sm:grid-cols-2">
        <>
          <input type="hidden" name="agencyId" value={agency.agency_id} />
          <Field label="Recurso"><select name="key" required className={inputClass} defaultValue="">{<option value="" disabled>Escolha…</option>}{definitions.data?.map((def) => <option key={def.key} value={def.key}>{def.label}</option>)}</select></Field>
          <Field label="Valor concedido" hint="Para funcionalidades: liberar ou bloquear. Para limites: informe o número (ou marque ilimitado). Dólares para o orçamento de IA (ex.: 10,00)."><div className="flex flex-wrap items-center gap-2">
            <select name="featureValue" className={`${inputClass} !w-auto`} aria-label="Funcionalidade"><option value="allow">Liberar</option><option value="block">Bloquear</option></select>
            <input name="limitValue" inputMode="decimal" placeholder="Limite" className={`${inputClass} !w-28`} aria-label="Limite" />
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name="limitMode" value="unlimited" />Ilimitado</label></div></Field>
          <Field label="Válida até (opcional)" hint="Sem data, vale até ser revogada."><input type="date" name="until" className={inputClass} /></Field>
          <Field label="Motivo"><input name="reason" required minLength={3} maxLength={300} placeholder="Ex.: demonstração para parceiro" className={inputClass} /></Field>
          <div className="sm:col-span-2"><SubmitButton className={secondaryButton}>Registrar concessão</SubmitButton></div>
        </>
      </ActionForm> : <p className="mt-4 text-sm text-[var(--muted)]">Concessões só fazem sentido em organizações com plano atribuído; as demais já não têm restrições.</p>}
    </section>
  </div>;
}
