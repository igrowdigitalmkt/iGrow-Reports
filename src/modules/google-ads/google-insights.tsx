"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, TrendingUp } from "lucide-react";
import { Select } from "@/components/ui/select";
import { useSort } from "@/components/ui/use-sort";
import { AnalyticsSparkline, AnalyticsTrendChart, ANALYTICS_COLORS, formatAnalyticsValue } from "@/modules/client-portal/analytics-charts";
import { changeDescription } from "@/modules/client-portal/analytics-comparison";
import { googleCampaignState, rankCampaigns } from "@/modules/client-portal/client-overview";
import { resultBreakdown, resultCostBreakdown } from "@/modules/client-portal/analytics-results";
import type { AnalyticsDashboardData, AnalyticsMetric } from "@/modules/client-portal/analytics-types";
import { SectionToggle } from "@/modules/client-portal/section-toggle";
import { PlatformLogo } from "@/modules/platforms/platform-logo";
import type { GoogleSectionView } from "./google-section";
import "@/modules/client-portal/analytics-dashboard.css";

const FIXED = ["spend", "primary_results", "cost_per_result"];
const FLOW = ["impressions", "cpm", "link_clicks", "ctr_link", "cpc_link"];
const whole = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Um cartão de indicador, igual ao da Meta: valor, variação sobre o período anterior e o desenho dos dias. */
function Kpi({ data, metric, fixed }: { data: AnalyticsDashboardData; metric: AnalyticsMetric; fixed: boolean }) {
  const change = changeDescription(data, metric);
  const color = ANALYTICS_COLORS[0];
  const results = metric.key === "primary_results" || metric.key === "cost_per_result"
    ? resultCostBreakdown(data.summary, data.campaigns.map(campaign => ({ values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId }))).sort((a, b) => b.value - a.value) : [];
  const value = data.summary[metric.key];
  return <article className={`analytics-kpi${fixed ? " is-fixed" : " is-removable"}`} style={{ "--metric-color": color, "--kpi-span": 4, cursor: "default" } as CSSProperties}>
    <div className="analytics-kpi-top"><span>{metric.label}</span></div>
    {results.length > 0
      ? <div className="analytics-result-metric-list" style={{ "--result-rows": results.length, "--result-columns": 1 } as CSSProperties}>
        {results.map(result => <div className="analytics-result-metric-row" key={result.key}>
          <strong className="analytics-result-metric-value">{metric.key === "primary_results" ? whole.format(result.value) : formatAnalyticsValue(result.cost, metric, data.currency)}</strong>
          <span className="analytics-result-metric-label"><span className="analytics-result-metric-label-line">{result.label.toLocaleLowerCase("pt-BR")}</span></span>
        </div>)}
      </div>
      : <strong className={`analytics-kpi-value${value == null ? " is-unavailable" : ""}`}>{formatAnalyticsValue(value, metric, data.currency)}</strong>}
    <div className={`analytics-kpi-change is-${change.direction}`}>
      {"up" in change ? change.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} /> : <span className="analytics-change-dash">—</span>}
      <span>{change.text}</span>
    </div>
    <AnalyticsSparkline values={data.daily.map(day => day.values[metric.key])} color={color} />
  </article>;
}

function AccountInsights({ section }: { section: GoogleSectionView }) {
  const { data } = section;
  const metric = (key: string) => data.metrics.find(item => item.key === key);
  const fixed = FIXED.flatMap(key => metric(key) ?? []);
  const flow = FLOW.flatMap(key => metric(key) ?? []);
  const chartMetrics = [...fixed.filter(item => item.key === "spend"), ...flow.filter(item => item.key === "impressions" || item.key === "link_clicks")];
  const [chartKey, setChartKey] = useState("spend");
  const [comparison, setComparison] = useState(true);
  const [chartType, setChartType] = useState<"line" | "bar">("bar");
  const main = chartMetrics.find(item => item.key === chartKey) ?? chartMetrics[0];
  const sort = useSort(["name"]);

  const campaigns = useMemo(() => rankCampaigns(data.campaigns.map(campaign => ({
    ...campaign, state: googleCampaignState(campaign.status), active: campaign.status === "ENABLED", spend: campaign.values.spend ?? null,
    result: resultBreakdown(campaign.values).sort((a, b) => b.value - a.value)[0] ?? null,
  }))), [data.campaigns]);
  const rows = sort.apply(campaigns, (row, key) => key === "name" ? row.name : key === "state" ? (row.active ? 0 : 1)
    : key === "result" ? row.result?.value ?? null : key === "cost" ? (row.result && row.spend != null && row.result.value > 0 ? row.spend / row.result.value : null) : (row.values[key] ?? null));
  const idle = !(data.summary.spend ?? 0) && data.campaigns.length === 0;
  const money = (value: number | null | undefined) => formatAnalyticsValue(value, { key: "spend", label: "", unit: "currency", precision: 2, desirable: "neutral" }, data.currency);
  const th = (key: string, label: string, numeric = false) => <th scope="col" className={numeric ? "numeric" : undefined} aria-sort={sort.aria(key)}>{sort.head(key, label)}</th>;

  return <div className="platform-account-block">
    <h3 className="platform-account-name">{section.name}</h3>
    {idle ? <p className="analytics-empty-copy">Nenhuma campanha encontrada nesta conta.</p> : <>
      <div className="analytics-kpi-grid analytics-kpi-grid-fixed">{fixed.map(item => <Kpi key={item.key} data={data} metric={item} fixed />)}</div>
      <div className="analytics-kpi-flow">{flow.map(item => <Kpi key={item.key} data={data} metric={item} fixed={false} />)}</div>
      {main && <article className="analytics-card analytics-evolution-card">
        <div className="analytics-chart-head">
          <div className="analytics-chart-head-top">
            <h3>Desempenho do período</h3>
            <div className="analytics-chart-head-tools">
              <div className="analytics-comparison-controls">
                <label className="analytics-compare-toggle"><input type="checkbox" checked={comparison} onChange={event => setComparison(event.target.checked)} disabled={data.coverage.previousStatus !== "complete"} /><span>Comparar período</span></label>
              </div>
              <div className="analytics-chart-switcher" role="group" aria-label="Tipo de gráfico">
                <button type="button" aria-pressed={chartType === "line"} className={chartType === "line" ? "is-active" : ""} onClick={() => setChartType("line")}><TrendingUp size={12} />Linhas</button>
                <button type="button" aria-pressed={chartType === "bar"} className={chartType === "bar" ? "is-active" : ""} onClick={() => setChartType("bar")}><BarChart3 size={12} />Barras</button>
              </div>
            </div>
          </div>
          <div className="analytics-chart-head-series">
            <label className="analytics-series-pick"><span>Indicador</span>
              <Select className="input" value={main.key} onChange={event => setChartKey(event.target.value)} aria-label="Indicador do gráfico">
                {chartMetrics.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
              </Select></label>
          </div>
        </div>
        <AnalyticsTrendChart data={data} metrics={[main]} comparison={comparison} chartType={chartType} height={260} />
      </article>}
      <article className="analytics-card cs-table">
        <div className="panel-heading"><div><h2>Campanhas</h2><p>Ativas, em veiculação ou que investiram no período selecionado.</p></div></div>
        {rows.length ? <div className="table-scroll"><table className="analytics-table analytics-campaign-table">
          <caption className="sr-only">Campanhas do Google Ads de {section.name}</caption>
          <thead><tr>{th("name", "Campanha")}{th("state", "Situação")}{th("spend", "Investimento", true)}{th("result", "Resultados", true)}{th("cost", "Custo por resultado", true)}{th("impressions", "Impressões", true)}{th("link_clicks", "Cliques", true)}{th("ctr_link", "CTR", true)}{th("cpc_link", "CPC", true)}</tr></thead>
          <tbody>{rows.map(row => {
            const cost = row.result && row.spend != null && row.result.value > 0 ? row.spend / row.result.value : null;
            return <tr key={row.id}>
              <th scope="row"><strong title={row.name}>{row.name}</strong></th>
              <td><span className={`badge ${row.active ? "green" : "neutral"}`}><span className="status-dot" />{row.state.label}</span></td>
              <td className="numeric">{money(row.spend)}</td>
              <td className="numeric">{row.result ? <span className="campaigns-result"><strong>{whole.format(row.result.value)}</strong><small>{row.result.label.toLocaleLowerCase("pt-BR")}</small></span> : <span className="muted">—</span>}</td>
              <td className="numeric">{row.result && cost != null ? <span className="campaigns-result"><strong>{money(cost)}</strong><small>Por {row.result.label.toLocaleLowerCase("pt-BR")}</small></span> : <span className="muted">—</span>}</td>
              <td className="numeric">{formatAnalyticsValue(row.values.impressions, { key: "impressions", label: "", unit: "integer", precision: 0, desirable: "up" }, null)}</td>
              <td className="numeric">{formatAnalyticsValue(row.values.link_clicks, { key: "link_clicks", label: "", unit: "integer", precision: 0, desirable: "up" }, null)}</td>
              <td className="numeric">{formatAnalyticsValue(row.values.ctr_link, { key: "ctr_link", label: "", unit: "percent", precision: 2, desirable: "up" }, null)}</td>
              <td className="numeric">{money(row.values.cpc_link)}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="analytics-empty-copy">Nenhuma campanha ativa ou com investimento neste período.</p>}
      </article>
    </>}
  </div>;
}

/** Google Ads no Dashboard, no mesmo padrão de exibição da Meta: indicadores com variação, gráfico do período e tabela de campanhas ordenável. */
export function GoogleDashboardSection({ sections, failures, order, collapsed, onToggle }: {
  sections: GoogleSectionView[]; failures: Array<{ name: string; message: string }>; order?: number; collapsed: boolean; onToggle: () => void;
}) {
  if (!sections.length && !failures.length) return null;
  return <section className="platform-section" aria-label="Google Ads" style={order === undefined ? undefined : { order }}>
    <div className="platform-heading"><SectionToggle collapsed={collapsed} label="Google Ads" onToggle={onToggle} /><PlatformLogo platform="google" /><h2>Google Ads</h2>
      <span className="platform-heading-meta">{sections.length} {sections.length === 1 ? "conta" : "contas"}</span></div>
    {!collapsed && <>
      {failures.map(failure => <p key={failure.name} role="alert" className="analytics-footnote" style={{ padding: "0 4px" }}>Não foi possível ler a conta {failure.name} agora. {failure.message}</p>)}
      {sections.map(section => <AccountInsights key={section.id} section={section} />)}
    </>}
  </section>;
}
