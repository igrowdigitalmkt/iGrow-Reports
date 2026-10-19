import { randomUUID } from "node:crypto";
import { requireAgencyContext } from "@/modules/agencies/context";
import { submitManualMetaChange } from "@/modules/agent-executor/manual-actions";
import { entityDeliveryActive, normalizeHierarchy } from "@/modules/client-portal/analytics-hierarchy";

export const dynamic = "force-dynamic";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Tela interna (fora do menu ate a homologacao): alteracao MANUAL de campanhas, executada pelo mesmo ledger. */
export default async function ManualChangesPage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const ctx = await requireAgencyContext();
  const { cliente } = await searchParams;
  const canEdit = ctx.role === "owner" || ctx.role === "admin";
  const { data: clients } = await ctx.supabase.from("clients").select("id,name")
    .eq("agency_id", ctx.agency.id).is("archived_at", null).order("name").limit(200);
  const selected = clients?.find(client => client.id === cliente);

  let rows: ReturnType<typeof normalizeHierarchy> = [];
  if (selected && canEdit) {
    const { data: links } = await ctx.supabase.from("client_ad_accounts").select("ad_account_id")
      .eq("agency_id", ctx.agency.id).eq("client_id", selected.id).eq("active", true);
    const ids = (links ?? []).map(link => link.ad_account_id);
    if (ids.length > 0) {
      const { data } = await ctx.supabase.rpc("get_client_analytics_hierarchy", {
        p_client_id: selected.id, p_date_from: day(-14), p_date_to: day(-1), p_ad_account_ids: ids,
      });
      rows = normalizeHierarchy(data ?? []).filter(entity => entity.level !== "ad");
    }
  }

  return <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Groow Ads · Agente IA</p>
      <h1 className="text-3xl font-semibold tracking-tight">Alterar campanhas manualmente</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Voce decide e a plataforma executa na Meta, com a mesma verificacao de seguranca e historico da IA.
        Esta acao e sua, nao uma aprovacao de proposta da IA. Exige proprietario ou administrador.
      </p>
    </header>
    {!canEdit ? <p className="rounded-2xl border border-border bg-card p-6 text-sm">Somente proprietario ou administrador pode alterar campanhas.</p> : <>
      <nav className="flex flex-wrap gap-2">{(clients ?? []).map(client =>
        <a key={client.id} href={`?cliente=${client.id}`}
          className={`rounded-full border px-3 py-1 text-sm ${client.id === selected?.id ? "border-foreground font-medium" : "border-border text-muted-foreground"}`}>{client.name}</a>)}
      </nav>
      {selected && rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma campanha ou conjunto com dados confirmados para este cliente.</p>}
      <div className="space-y-3">{rows.map(entity => {
        const active = entityDeliveryActive(entity);
        const prefix = entity.level === "campaign" ? "campaign" : "adset";
        return <article key={entity.key} className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{entity.name} <span className="text-xs text-muted-foreground">· {entity.level === "campaign" ? "Campanha" : "Conjunto"}</span></h2>
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{active ? "Ativo" : "Desativado"}</span>
          </div>
          <form action={submitManualMetaChange} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="requestId" value={randomUUID()} />
            <input type="hidden" name="clientId" value={selected!.id} />
            <input type="hidden" name="adAccountId" value={entity.accountId} />
            <input type="hidden" name="targetId" value={entity.id} />
            <button name="action" value={active ? `pause_${prefix}` : `resume_${prefix}`} type="submit"
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">{active ? "Pausar" : "Reativar"}</button>
            {active && <>
              <label className="text-xs text-muted-foreground">Novo orcamento diario (unidade minima, ex.: 5000 = R$ 50,00)
                <input name="dailyBudgetMinor" inputMode="numeric" pattern="[0-9]*" className="mt-1 block w-48 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
              </label>
              <button name="action" value={`set_${prefix}_daily_budget`} type="submit"
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium">Alterar orcamento</button>
            </>}
          </form>
        </article>;
      })}</div>
    </>}
  </main>;
}
