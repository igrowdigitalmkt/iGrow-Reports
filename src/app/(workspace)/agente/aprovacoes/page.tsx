import { listPendingAgentFinancialApprovals, listRecentAgentActivity, submitAgentFinancialApproval } from "@/modules/agent-executor/approval-actions";

export const dynamic = "force-dynamic";
const names: Record<string, string> = {
  pause_campaign: "Pausar campanha", resume_campaign: "Reativar campanha",
  pause_adset: "Pausar conjunto", resume_adset: "Reativar conjunto",
  set_campaign_daily_budget: "Alterar orcamento diario de campanha",
  set_adset_daily_budget: "Alterar orcamento diario de conjunto",
};

const statusLabels: Record<string, string> = {
  queued: "Na fila", executing: "Executando", verifying: "Verificando", verified: "Concluida e confirmada na Meta",
  failed: "Nao executada", rejected: "Recusada", expired: "Expirada", needs_verification: "Aguardando conciliacao",
  authorized: "Autorizada", proposed: "Proposta",
};

/** Tela interna, nao incluida no menu ate a homologacao. */
export default async function AgentApprovalsPage() {
  const [pending, activity] = await Promise.all([listPendingAgentFinancialApprovals(), listRecentAgentActivity()]);
  const attention = activity.filter(item => item.needsAttention);
  return <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Groow Ads · Agente IA</p>
      <h1 className="text-3xl font-semibold tracking-tight">Aprovacoes financeiras</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">
        A IA pode analisar e preparar propostas. Toda mudanca com impacto no gasto
        ou na veiculacao precisa de aprovacao especifica. Aprovar esta acao nao
        autoriza modificacoes futuras.
      </p>
    </header>
    {pending.length === 0 ? <section className="rounded-2xl border border-border bg-card p-7">
      <h2 className="text-lg font-medium">Nenhuma solicitacao pendente</h2>
      <p className="mt-2 text-sm text-muted-foreground">As propostas elegiveis da IA aparecerao aqui para sua decisao.</p>
    </section> : <div className="space-y-4">{pending.map(job => {
      const expired = job.expired;
      return <article key={job.id} className="space-y-5 rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{names[job.action] ?? "Alteracao de campanha"}</h2>
          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            {expired ? "Prazo expirado" : "Aguardando aprovacao"}
          </span>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Entidade Meta</dt><dd>{job.metaEntityId}</dd></div>
          <div><dt className="font-semibold">Conta vinculada</dt><dd>{job.accountId}</dd></div>
          {job.dailyBudgetMinor !== null && <div>
            <dt className="font-semibold">Orcamento proposto</dt>
            <dd>{job.dailyBudgetMinor} unidades minimas da moeda da conta</dd>
          </div>}
          <div><dt className="font-semibold">Validade</dt>
            <dd>{job.expiresAt ? new Date(job.expiresAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" }) : "Indisponivel"}</dd>
          </div>
        </dl>
        <div className="rounded-xl bg-muted/50 p-4 text-sm">
          <p className="mb-1 font-semibold">Justificativa da IA</p>
          <p className="whitespace-pre-wrap">{job.rationale}</p>
        </div>
        <form action={submitAgentFinancialApproval} className="flex flex-wrap gap-3">
          <input type="hidden" name="jobId" value={job.id} />
          <input type="hidden" name="approvalFingerprint" value={job.approvalFingerprint} />
          <button name="decision" value="approve" type="submit" disabled={expired}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-35">
            Aprovar esta acao
          </button>
          <button name="decision" value="reject" type="submit" disabled={expired}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-35">
            Recusar
          </button>
        </form>
      </article>;
    })}</div>}
    {attention.length > 0 && <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-6">
      <h2 className="text-lg font-semibold">Exige atencao</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {attention.length} alteracao(oes) com resultado incerto. Enquanto nao forem conciliadas, a conta fica bloqueada
        para novas alteracoes. Confira a campanha na Meta se isso persistir.
      </p>
    </section>}
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Atividade recente</h2>
      {activity.length === 0 ? <p className="text-sm text-muted-foreground">Ainda nao ha atividade registrada.</p> : <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {activity.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
          <span>{names[item.action] ?? "Alteracao de campanha"} <span className="text-muted-foreground">· {item.origin === "manual" ? "manual" : "IA"}</span>
            {item.note && <span className="block text-xs text-muted-foreground">{item.note}</span>}</span>
          <span className="text-xs text-muted-foreground">{statusLabels[item.status] ?? item.status} · {new Date(item.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Fortaleza" })}</span>
        </li>)}
      </ul>}
    </section>
  </main>;
}
