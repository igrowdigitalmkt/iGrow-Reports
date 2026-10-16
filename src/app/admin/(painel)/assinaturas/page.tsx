import { requirePlatformOperator } from "@/modules/platform-admin/guard";
import { adminRpc, billingDashboardSchema } from "@/modules/platform-admin/commercial/billing-settings";
import { formatBrl } from "@/modules/platform-admin/commercial/format";
import { resolveBillingEnvironment } from "@/modules/billing/credentials";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assinaturas" };

const card = "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5";
const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const day = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
const STATUS: Record<string, string> = { pending: "Aguardando pagamento", active: "Ativa", past_due: "Em atraso", suspended: "Suspensa", canceled: "Cancelada" };
const FLAGS: Record<string, string> = {
  never_ran: "O cron financeiro nunca foi executado (ou o agendamento não está configurado)", no_recent_success: "Sem execução bem-sucedida há mais de 15 minutos (o cron parou)",
  consecutive_failures: "Três ou mais execuções seguidas sem sucesso", events_backlog: "Eventos financeiros acumulados", reconcile_backlog: "Assinaturas sem conferência no Asaas há mais de 2 horas",
  intents_backlog: "Contratações expiradas sem conferência", monitor_unavailable: "Monitoramento indisponível",
};

function Count({ label, value, tone }: { label: string; value: number; tone?: "bad" | "warn" | "good" }) {
  const color = tone === "bad" ? "text-[var(--bad)]" : tone === "warn" ? "text-[var(--warn)]" : tone === "good" ? "text-[var(--good)]" : "";
  return <div className="rounded-lg border border-[var(--border)] p-3"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className={`mt-1 text-2xl font-semibold ${color}`}>{value}</dd></div>;
}

export default async function SubscriptionsPage() {
  const { supabase } = await requirePlatformOperator();
  const environment = await resolveBillingEnvironment();
  const result = await adminRpc(supabase)("platform_billing_dashboard", { p_environment: environment });
  const parsed = billingDashboardSchema.safeParse(result.data);
  if (!parsed.success) return <div className="space-y-6"><h1 className="text-2xl font-semibold tracking-tight">Assinaturas</h1>
    <p role="alert" className="text-sm text-[var(--bad)]">Não foi possível carregar o acompanhamento agora. Confira se a migration das configurações comerciais já foi aplicada neste ambiente.</p></div>;
  const d = parsed.data;
  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Assinaturas</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--secondary)]">Visão operacional somente leitura. O Asaas é a fonte de verdade dos pagamentos: nada aqui confirma, cancela ou altera cobranças. Ambiente: {environment === "production" ? "produção" : "Sandbox (testes)"} · cobrança real {d.live_enabled ? "ligada" : "desligada"}.</p>
    </header>
    <section className={card} aria-labelledby="subs"><h2 id="subs" className="text-sm font-semibold">Assinaturas</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Count label="Ativas" value={d.subscriptions.active} tone="good" /><Count label="Em atraso" value={d.subscriptions.past_due} tone={d.subscriptions.past_due ? "warn" : undefined} />
        <Count label="Suspensas" value={d.subscriptions.suspended} tone={d.subscriptions.suspended ? "bad" : undefined} /><Count label="Aguardando pagamento" value={d.subscriptions.pending} />
        <Count label="Cancelamentos agendados" value={d.subscriptions.cancel_scheduled} /><Count label="Canceladas" value={d.subscriptions.canceled} />
      </dl></section>
    <section className={card} aria-labelledby="trials"><h2 id="trials" className="text-sm font-semibold">Testes gratuitos</h2>
      <dl className="mt-3 grid grid-cols-3 gap-3"><Count label="Em andamento" value={d.trials.active} /><Count label="Vencem em até 3 dias" value={d.trials.ending_in_3_days} tone={d.trials.ending_in_3_days ? "warn" : undefined} /><Count label="Vencidos" value={d.trials.expired} /></dl></section>
    <section className={card} aria-labelledby="eventos"><h2 id="eventos" className="text-sm font-semibold">Eventos financeiros</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"><Count label="Pendentes de processamento" value={d.events.pending} tone={d.events.pending ? "warn" : undefined} />
        <Count label="Exigem revisão" value={d.events.needs_review} tone={d.events.needs_review ? "bad" : undefined} />
        <div className="rounded-lg border border-[var(--border)] p-3"><dt className="text-xs text-[var(--muted)]">Pendente mais antigo</dt><dd className="mt-1 text-sm">{d.events.oldest_pending_at ? when.format(new Date(d.events.oldest_pending_at)) : "—"}</dd></div></dl></section>
    <section className={card} aria-labelledby="cron"><h2 id="cron" className="text-sm font-semibold">Cron financeiro</h2>
      <p className={`mt-2 text-sm font-medium ${d.cron.ok ? "text-[var(--good)]" : "text-[var(--bad)]"}`}>{d.cron.ok ? "Saudável" : "Atenção"}</p>
      {!d.cron.ok && <ul className="mt-1 list-disc pl-5 text-sm text-[var(--secondary)]">{d.cron.flags.map(flag => <li key={flag}>{FLAGS[flag] ?? flag}</li>)}</ul>}
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-[var(--muted)]">Última execução</dt><dd>{d.cron.last_run_at ? `${when.format(new Date(d.cron.last_run_at))} (${d.cron.last_run_status})` : "Nunca"}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Último sucesso</dt><dd>{d.cron.last_success_at ? when.format(new Date(d.cron.last_success_at)) : "—"}</dd></div>
        <div><dt className="text-xs text-[var(--muted)]">Execuções na última hora</dt><dd>{d.cron.runs_last_hour}</dd></div></dl></section>
    <section className={card} aria-labelledby="atencao"><h2 id="atencao" className="text-sm font-semibold">Exigem atenção</h2>
      {!d.attention.length ? <p className="mt-3 text-sm text-[var(--muted)]">Nenhuma assinatura em atraso, suspensa ou com pendência.</p>
        : <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm"><thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Organização</th><th className="py-1.5 pr-3 font-medium">Situação</th><th className="py-1.5 pr-3 font-medium">Valor</th><th className="py-1.5 pr-3 font-medium">Período pago até</th><th className="py-1.5 font-medium">Observação</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">{d.attention.map(item => <tr key={`${item.agency_id}-${item.status}`}><td className="py-2.5 pr-3">{item.agency_name}</td>
            <td className="py-2.5 pr-3">{STATUS[item.status] ?? item.status}{item.status === "past_due" && item.grace_ends_at ? ` · tolerância até ${day.format(new Date(item.grace_ends_at))}` : ""}</td>
            <td className="py-2.5 pr-3">{formatBrl(item.amount_cents)} / {item.cycle === "yearly" ? "ano" : "mês"}</td>
            <td className="py-2.5 pr-3">{item.current_period_end ? day.format(new Date(item.current_period_end)) : "—"}</td>
            <td className="py-2.5 text-[var(--secondary)]">{item.attention_reason ?? (item.remote_cancel_pending ? "Cancelamento aguardando confirmação do Asaas" : "—")}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
