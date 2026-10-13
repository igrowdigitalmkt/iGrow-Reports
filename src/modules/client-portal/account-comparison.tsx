import { resultCostBreakdown } from "./analytics-results";
import type { AnalyticsDashboardData } from "./analytics-types";

const whole = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const ok = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);

// Contas selecionadas lado a lado, cada uma com os próprios números. Os resultados de contas diferentes nunca são somados.
type AccountView = { id: string; name: string; data: AnalyticsDashboardData };
export function accountSummaries(data: AnalyticsDashboardData, views: AccountView[] = []) {
  return data.accountTotals.filter(account => data.selectedAccountIds.includes(account.id)).map(account => {
    // A leitura da própria conta (quando existe) traz os resultados por tipo e a confirmação da Meta.
    const own = views.find(view => view.id === account.id)?.data;
    const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: account.currency || data.currency || "BRL" });
    const values = own?.summary ?? account.values;
    const campaigns = (own?.campaigns ?? data.campaigns).filter(campaign => campaign.accountId === account.id)
      .map(campaign => ({ values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId }));
    const results = resultCostBreakdown(values, campaigns).sort((a, b) => b.value - a.value);
    return {
      id: account.id, name: account.name,
      metrics: [
        ["Investimento", ok(values.spend) ? money.format(values.spend) : "—"],
        ["Alcance", ok(values.reach) ? whole.format(values.reach) : "—"],
        ["Impressões", ok(values.impressions) ? whole.format(values.impressions) : "—"],
        ["Cliques no link", ok(values.link_clicks) ? whole.format(values.link_clicks) : "—"],
      ] as Array<[string, string]>,
      results: results.map(result => ({ label: result.label, value: whole.format(result.value), cost: result.cost != null ? money.format(result.cost) : null })),
      idle: !(values.spend ?? 0),
    };
  });
}

export function AccountComparison({ data, views, onOpen }: { data: AnalyticsDashboardData; views?: AccountView[]; onOpen: (accountId: string) => void }) {
  const accounts = accountSummaries(data, views);
  return <section className="analytics-card" aria-label="Contas lado a lado">
    <div className="analytics-card-heading"><div><h3>Resultados por conta</h3>
      <p className="analytics-report-help">Cada conta de anúncios aparece separada, com os próprios resultados. Marque “Consolidar resultados” no filtro de contas para somar tudo como uma conta só.</p></div></div>
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
      {accounts.map(account => <article key={account.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "grid", gap: 8 }}>
        <h4 style={{ margin: 0 }}>{account.name}</h4>
        {account.idle ? <p className="muted">Sem investimento neste período.</p> : <>
          <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 12px", margin: 0 }}>
            {account.metrics.map(([label, value]) => <div key={label} style={{ display: "contents" }}><dt className="muted">{label}</dt><dd style={{ margin: 0, textAlign: "right" }}>{value}</dd></div>)}
          </dl>
          {account.results.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{account.results.map(result => <li key={result.label}>{result.value} {result.label.toLowerCase()}{result.cost ? ` (${result.cost} cada)` : ""}</li>)}</ul>}
        </>}
        <button type="button" className="analytics-button" onClick={() => onOpen(account.id)}>Ver detalhes desta conta</button>
      </article>)}
    </div>
  </section>;
}
