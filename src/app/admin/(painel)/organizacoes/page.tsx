import Link from "next/link";
import { requirePlatformOperator } from "@/modules/platform-admin/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organizações" };

export default async function AgenciesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().slice(0, 80);
  const { supabase } = await requirePlatformOperator();
  const { data: agencies, error } = await supabase.rpc("platform_list_agencies", { p_query: query || null, p_limit: 100 });
  const day = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });
  return <div className="space-y-6">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Organizações e concessões</h1>
      <p className="mt-1 max-w-2xl text-sm text-[var(--secondary)]">Organizações sem plano atribuído continuam exatamente como hoje, sem restrição comercial. Ao conceder um plano (concessão administrativa gratuita, sempre com motivo e auditada), as regras dele passam a valer para aquela organização. Assinaturas pagas nascerão só da integração de pagamento. Só são mostrados nomes e contagens, nunca os dados privados dos clientes.</p>
    </header>
    <form className="flex max-w-md gap-2" role="search">
      <input name="q" defaultValue={query} placeholder="Buscar pelo nome da organização" aria-label="Buscar organização" className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm outline-none focus:border-[var(--focus)]" />
      <button type="submit" className="rounded-lg border border-[var(--border-strong)] px-4 py-2 text-sm font-medium hover:bg-[var(--surface-hover)]">Buscar</button>
    </form>
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      {error ? <p role="alert" className="text-sm text-[var(--bad)]">Não foi possível carregar as organizações agora.</p>
        : !agencies?.length ? <p className="text-sm text-[var(--muted)]">Nenhuma organização encontrada.</p>
        : <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-xs text-[var(--muted)]"><tr><th className="py-1.5 pr-3 font-medium">Organização</th><th className="py-1.5 pr-3 font-medium">Criada em</th><th className="py-1.5 pr-3 font-medium">Equipe</th><th className="py-1.5 pr-3 font-medium">Clientes ativos</th><th className="py-1.5 pr-3 font-medium">Plano (tipo)</th><th className="py-1.5 font-medium">Concessões ativas</th></tr></thead>
          <tbody className="divide-y divide-[var(--border)]">{agencies.map((agency) => <tr key={agency.agency_id}>
            <td className="py-2.5 pr-3"><Link href={`/admin/organizacoes/${agency.agency_id}`} className="font-medium text-[var(--blue)] hover:underline">{agency.name}</Link></td>
            <td className="py-2.5 pr-3">{day.format(new Date(agency.created_at))}</td><td className="py-2.5 pr-3">{agency.members}</td><td className="py-2.5 pr-3">{agency.clients}</td>
            <td className="py-2.5 pr-3">{agency.plan_name ? `${agency.plan_name} (v${agency.plan_version}) · ${agency.assignment_kind === "subscription" ? "assinatura paga" : "concessão"}` : <span className="text-[var(--muted)]">Nenhum (sem restrição)</span>}</td><td className="py-2.5">{agency.active_overrides}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
