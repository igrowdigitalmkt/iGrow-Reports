import { resultCostBreakdown } from "@/modules/client-portal/analytics-results";
import { SectionToggle } from "@/modules/client-portal/section-toggle";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";

const whole = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const ok = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

export type GoogleSectionView = { id: string; name: string; data: AnalyticsDashboardData };

// Dados de uma conta do Google Ads prontos para exibir: totais, resultados com custo e principais campanhas.
export function googleAccountSummary(section: GoogleSectionView) {
  const { data } = section;
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: data.currency || "BRL" });
  const percent = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sources = data.campaigns.map(campaign => ({ values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId }));
  const results = resultCostBreakdown(data.summary, sources).sort((a, b) => b.value - a.value);
  const campaigns = [...data.campaigns].sort((a, b) => (b.values.spend ?? 0) - (a.values.spend ?? 0)).slice(0, 5).map(campaign => {
    const own = resultCostBreakdown(campaign.values, [{ values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId }])[0];
    return { id: campaign.id, name: campaign.name, spend: ok(campaign.values.spend) ? money.format(campaign.values.spend) : "—",
      result: own ? `${whole.format(own.value)} ${own.label.toLowerCase()}${own.cost != null ? ` (${money.format(own.cost)} cada)` : ""}` : "Sem resultado no período" };
  });
  return {
    id: section.id, name: section.name,
    metrics: [
      ["Investimento", ok(data.summary.spend) ? money.format(data.summary.spend) : "—"],
      ["Impressões", ok(data.summary.impressions) ? whole.format(data.summary.impressions) : "—"],
      ["Cliques", ok(data.summary.link_clicks) ? whole.format(data.summary.link_clicks) : "—"],
      ["CTR", ok(data.summary.ctr_link) ? `${percent.format(data.summary.ctr_link)}%` : "—"],
      ["CPC", ok(data.summary.cpc_link) ? money.format(data.summary.cpc_link) : "—"],
    ] as Array<[string, string]>,
    results: results.map(result => ({ label: result.label, value: whole.format(result.value), cost: result.cost != null ? money.format(result.cost) : null })),
    campaigns, idle: !(data.summary.spend ?? 0),
  };
}

// Seção do Google Ads no painel do cliente: uma conta por bloco, com resultados e custos próprios.
export function GoogleAdsSection({ sections, failures, order, collapsed = false, onToggle }: { sections: GoogleSectionView[]; failures: Array<{ name: string; message: string }>; order?: number; /** Recolher/expandir (só nas telas que passam `onToggle`). */ collapsed?: boolean; onToggle?: () => void }) {
  if (!sections.length && !failures.length) return null;
  return <section className="platform-section" aria-label="Google Ads" style={order === undefined ? undefined : { order }}>
    <div className="platform-heading"><span className="platform-mark is-google" aria-hidden="true">G</span><h2>Google Ads</h2>{onToggle && <SectionToggle collapsed={collapsed} label="Google Ads" onToggle={onToggle} />}
      <span className="platform-heading-meta">{sections.length} {sections.length === 1 ? "conta" : "contas"}</span></div>
    {!collapsed && <>
    {failures.map(failure => <p key={failure.name} role="alert" className="analytics-footnote" style={{ padding: "0 4px" }}>Não foi possível ler a conta {failure.name} agora. {failure.message}</p>)}
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      {sections.map(section => {
        const summary = googleAccountSummary(section);
        return <article key={summary.id} className="analytics-card" style={{ display: "grid", gap: 10, padding: 18, alignContent: "start" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{summary.name}</h3>
          {summary.idle ? <p className="muted">Sem investimento neste período.</p> : <>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", margin: 0 }}>
              {summary.metrics.map(([label, value]) => <div key={label} style={{ display: "contents" }}><dt className="muted">{label}</dt><dd style={{ margin: 0, textAlign: "right" }}>{value}</dd></div>)}
            </dl>
            {summary.results.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{summary.results.map(result => <li key={result.label}>{result.value} {result.label.toLowerCase()}{result.cost ? ` (${result.cost} cada)` : ""}</li>)}</ul>}
            {summary.campaigns.length > 0 && <div style={{ display: "grid", gap: 6 }}>
              <strong style={{ fontSize: 13 }}>Principais campanhas</strong>
              {summary.campaigns.map(campaign => <div key={campaign.id} style={{ display: "grid", gap: 2 }}><span>{campaign.name}</span><small className="muted">{campaign.spend} · {campaign.result}</small></div>)}
            </div>}
          </>}
        </article>;
      })}
    </div>
    </>}
  </section>;
}
