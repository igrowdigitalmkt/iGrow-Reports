import { Button } from "@/components/ui/button";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { submitManualMetaChange } from "@/modules/agent-executor/manual-actions";
import { readLiveEntityStateDetailed, type LiveEntityState } from "@/modules/agent-executor/decision-live-state";
import { normalizeHierarchy, type AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";

export const dynamic = "force-dynamic";
// A acao de solicitar executa a alteracao na hora (GET + POST + GET de confirmacao na Meta).
export const maxDuration = 60;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativo", PAUSED: "Pausado", CAMPAIGN_PAUSED: "Campanha pausada", ADSET_PAUSED: "Conjunto pausado",
  ARCHIVED: "Arquivado", DELETED: "Excluido", IN_PROCESS: "Em processamento", WITH_ISSUES: "Com problemas",
};

const RESULTS: Record<string, { tone: "good" | "warn"; text: string }> = {
  ok_verified: { tone: "good", text: "Alteracao executada e confirmada na Meta." },
  ok_needs_verification: { tone: "warn", text: "A Meta nao confirmou ainda; a conta fica bloqueada ate a conciliacao. Veja Atividade recente." },
  ok_failed: { tone: "warn", text: "A alteracao foi bloqueada antes de enviar (verificacao de seguranca). Nada foi alterado." },
  ok_gate_closed: { tone: "warn", text: "Execucao nao habilitada para esta organizacao. Nada foi alterado." },
  ok_unavailable: { tone: "warn", text: "Servico indisponivel; consulte a Atividade recente." },
  executor_disabled: { tone: "warn", text: "A execucao esta desabilitada neste ambiente (AGENT_SCHEDULER_ENABLED). Nada foi alterado na Meta." },
  gate_closed: { tone: "warn", text: "Execucao nao habilitada para esta organizacao. Nada foi alterado." },
  account_busy: { tone: "warn", text: "Ja existe uma alteracao em andamento nesta conta. Aguarde a conclusao." },
  duplicate: { tone: "warn", text: "Esta solicitacao ja tinha sido registrada." },
};

type Row = { entity: AnalyticsEntity; live: LiveEntityState; accountName: string; accountOk: boolean };

/**
 * Tela interna (fora do menu ate a homologacao): alteracao MANUAL de campanhas, executada pelo mesmo ledger.
 * Status e titularidade vem AO VIVO da Meta: so aparece o que a Meta confirma pertencer a conta vinculada
 * a ESTE cliente. O cache de metricas nao e fonte de status de veiculacao.
 */
export default async function ManualChangesPage({ searchParams }: { searchParams: Promise<{ cliente?: string; resultado?: string }> }) {
  const ctx = await requireAgencyContext();
  const { cliente, resultado } = await searchParams;
  const canEdit = ctx.role === "owner" || ctx.role === "admin";
  const { data: clients } = await ctx.supabase.from("clients").select("id,name")
    .eq("agency_id", ctx.agency.id).is("archived_at", null).order("name").limit(200);
  const selected = clients?.find(client => client.id === cliente);

  const rows: Row[] = [];
  const notes: string[] = [];
  let liveFailed = false;
  if (selected && canEdit) {
    const { data: links } = await ctx.supabase.from("client_ad_accounts").select("ad_account_id")
      .eq("agency_id", ctx.agency.id).eq("client_id", selected.id).eq("active", true);
    const ids = (links ?? []).map(link => link.ad_account_id);
    const { data: accounts } = ids.length ? await ctx.supabase.from("meta_ad_accounts")
      .select("id,name,external_id,account_status").eq("agency_id", ctx.agency.id).in("id", ids).is("archived_at", null)
      : { data: [] };
    const hierarchy = ids.length ? await ctx.supabase.rpc("get_client_analytics_hierarchy", {
      p_client_id: selected.id, p_date_from: day(-14), p_date_to: day(-1), p_ad_account_ids: ids,
    }) : { data: [] };
    const entities = normalizeHierarchy(hierarchy.data ?? []).filter(entity => entity.level !== "ad");
    const service = createSupabaseServiceClient();
    for (const account of accounts ?? []) {
      const own = entities.filter(entity => entity.accountId === account.id);
      const usable = account.account_status === "1" || account.account_status === "ACTIVE";
      if (!usable) { notes.push(`${account.name}: conta indisponivel na Meta (status ${account.account_status ?? "?"}); nao consultada.`); continue; }
      if (own.length === 0) { notes.push(`${account.name}: nenhuma campanha com dados nos ultimos 14 dias.`); continue; }
      const result = service ? await readLiveEntityStateDetailed(service,
        { agencyId: ctx.agency.id, clientId: selected.id, adAccountId: account.id }, own.map(entity => entity.id)) : null;
      if (!result?.ok) {
        liveFailed = true;
        notes.push(`${account.name}: falha ao ler na Meta (${result ? `${result.reason}${result.detail ? `, ${result.detail}` : ""}` : "servico indisponivel"}).`);
        continue;
      }
      const live = result.state;
      notes.push(`${account.name}: ${live.size} de ${own.length} entidades confirmadas na Meta.`);
      for (const entity of own) {
        const state = live.get(entity.id);
        // Descarta qualquer entidade que a Meta nao confirme como pertencente a esta conta.
        if (!state || state.accountExternalId !== account.external_id) continue;
        rows.push({ entity, live: state, accountName: account.name, accountOk: account.account_status === "1" || account.account_status === "ACTIVE" });
      }
    }
  }

  return <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Groow Ads · Agente IA</p>
      <h1 className="text-3xl font-semibold tracking-tight">Alterar campanhas manualmente</h1>
      <p className="max-w-3xl text-sm text-muted">
        Voce decide e a plataforma executa na Meta, com a mesma verificacao de seguranca e historico da IA.
        Esta acao e sua, nao uma aprovacao de proposta da IA. O clique executa imediatamente. Exige proprietario ou administrador.
      </p>
    </header>
    {!canEdit ? <p className="rounded-xl border border-border bg-[var(--surface)] p-6 text-sm">Somente proprietario ou administrador pode alterar campanhas.</p> : <>
      <nav className="flex flex-wrap gap-2">{(clients ?? []).map(client =>
        <a key={client.id} href={`?cliente=${client.id}`}
          className={`rounded-full border px-3 py-1 text-sm ${client.id === selected?.id ? "border-foreground font-medium" : "border-border text-muted"}`}>{client.name}</a>)}
      </nav>
      {resultado && RESULTS[resultado] && <p className={`rounded-xl border p-4 text-sm ${RESULTS[resultado].tone === "good" ? "border-[var(--good)] bg-[var(--good-bg)]" : "border-[var(--warn)] bg-[var(--warn-bg)]"}`}>{RESULTS[resultado].text}</p>}
      {!selected && <p className="text-sm text-muted">Escolha um cliente para ver as campanhas confirmadas na Meta.</p>}
      {selected && liveFailed && <p className="rounded-2xl border border-[var(--warn)] bg-[var(--warn-bg)] p-4 text-sm">
        Nao foi possivel confirmar o estado atual na Meta para alguma conta. Nada e exibido sem essa confirmacao.</p>}
      {selected && notes.length > 0 && <ul className="space-y-1 text-xs text-muted">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
      {selected && !liveFailed && rows.length === 0 && <p className="text-sm text-muted">Nenhuma campanha ou conjunto confirmado na Meta para este cliente.</p>}
      <div className="space-y-3">{rows.map(({ entity, live, accountName, accountOk }) => {
        const status = (live.configuredStatus ?? "").toUpperCase();
        const prefix = entity.level === "campaign" ? "campaign" : "adset";
        const canAct = accountOk && (status === "ACTIVE" || status === "PAUSED");
        const delivery = live.effectiveStatus ? (STATUS_LABELS[live.effectiveStatus.toUpperCase()] ?? live.effectiveStatus) : "Indisponivel";
        return <article key={entity.key} className="space-y-3 rounded-xl border border-border bg-[var(--surface)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{entity.name} <span className="text-xs text-muted">· {entity.level === "campaign" ? "Campanha" : "Conjunto"} · {accountName}</span></h2>
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
              Configurado: {STATUS_LABELS[status] ?? (status || "?")} · Entrega: {delivery}
            </span>
          </div>
          {!canAct ? <p className="text-xs text-muted">
            {accountOk ? "Estado atual nao permite pausar ou reativar por aqui." : "Conta de anuncios indisponivel na Meta."}</p> :
          <form action={submitManualMetaChange} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="requestId" value={randomUUID()} />
            <input type="hidden" name="clientId" value={selected!.id} />
            <input type="hidden" name="adAccountId" value={entity.accountId} />
            <input type="hidden" name="targetId" value={entity.id} />
            <Button name="action" value={status === "ACTIVE" ? `pause_${prefix}` : `resume_${prefix}`} type="submit">{status === "ACTIVE" ? "Pausar" : "Reativar"}</Button>
            {status === "ACTIVE" && live.dailyBudgetMinor !== null && <>
              <label className="text-xs text-muted">Novo orcamento diario (unidade minima; atual {live.dailyBudgetMinor}; ex.: 5000 = R$ 50,00)
                <input name="dailyBudgetMinor" inputMode="numeric" pattern="[0-9]*" className="mt-1 block w-48 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
              </label>
              <Button variant="secondary" name="action" value={`set_${prefix}_daily_budget`} type="submit">Alterar orcamento</Button>
            </>}
          </form>}
        </article>;
      })}</div>
    </>}
  </main>;
}
