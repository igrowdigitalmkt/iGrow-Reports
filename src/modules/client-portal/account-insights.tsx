"use client";

import { useMemo, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, BarChart3, ChevronDown, Filter, GripVertical, Search, TrendingUp, X } from "lucide-react";
import { Select } from "@/components/ui/select";
import { useSort } from "@/components/ui/use-sort";
import { classifyDelivery } from "@/modules/campaigns/delivery-state";
import { AnalyticsSparkline, AnalyticsTrendChart, ANALYTICS_COLORS, formatAnalyticsValue } from "./analytics-charts";
import { changeDescription } from "./analytics-comparison";
import { googleCampaignState, rankCampaigns } from "./client-overview";
import { resultBreakdown, resultCostBreakdown } from "./analytics-results";
import type { AnalyticsDashboardData, AnalyticsMetric } from "./analytics-types";
import "./analytics-dashboard.css";

// Mesma lógica da Meta: três indicadores fixos; os demais podem ser removidos, trocados, reordenados e salvos por usuário.
export const FIXED_ACCOUNT_METRICS = ["spend", "primary_results", "cost_per_result"];
export const DEFAULT_OPTIONAL_ACCOUNT_METRICS = ["impressions", "cpm", "link_clicks", "ctr_link", "cpc_link"];
const whole = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const numberMetric = (key: string, unit: AnalyticsMetric["unit"]): AnalyticsMetric => ({ key, label: "", unit, precision: unit === "percent" || unit === "currency" ? 2 : 0, desirable: "up" });

type KpiHandlers = {
  dragging: string | null; dropTarget: string | null; replacements: AnalyticsMetric[];
  onDragStart: (key: string) => void; onDragEnter: (key: string) => void; onDrop: (key: string) => void; onDragEnd: () => void;
  onRemove: (key: string) => void; onSwap: (key: string, replacement: string) => void;
};

/** Um cartão de indicador, igual ao da Meta: valor, variação sobre o período anterior e o desenho dos dias. */
function Kpi({ data, metric, fixed, handlers }: { data: AnalyticsDashboardData; metric: AnalyticsMetric; fixed: boolean; handlers?: KpiHandlers }) {
  const change = changeDescription(data, metric);
  const color = ANALYTICS_COLORS[0];
  const results = metric.key === "primary_results" || metric.key === "cost_per_result"
    ? resultCostBreakdown(data.summary, data.campaigns.map(campaign => ({ values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId }))).sort((a, b) => b.value - a.value) : [];
  const value = data.summary[metric.key];
  const movable = !fixed && !!handlers;
  const className = `analytics-kpi${metric.key === "spend" ? " is-spend" : ""}${fixed ? " is-fixed" : " is-removable"}${movable && handlers.dragging === metric.key ? " is-dragging" : ""}${movable && handlers.dropTarget === metric.key && handlers.dragging !== metric.key ? " is-drop-target" : ""}`;
  const dragProps = movable ? {
    draggable: true,
    onDragStart: (event: React.DragEvent) => { handlers.onDragStart(metric.key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", metric.key); },
    onDragEnter: () => handlers.dragging && handlers.onDragEnter(metric.key),
    onDragOver: (event: React.DragEvent) => { if (handlers.dragging) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); handlers.onDrop(metric.key); },
    onDragEnd: handlers.onDragEnd,
  } : {};
  return <article className={className} style={{ "--metric-color": color, "--kpi-span": 4 } as CSSProperties} {...dragProps}>
    <div className="analytics-kpi-top"><span>{movable && <GripVertical size={14} className="analytics-kpi-grip" aria-hidden="true" />}{metric.label}</span>
      {movable && <div className="analytics-kpi-tools">
        {handlers.replacements.length > 0 && <span className="analytics-kpi-swap">
          <Select className="analytics-kpi-swap-trigger" title="Trocar métrica" aria-label={`Trocar ${metric.label} por outra métrica`} value="" alignEnd
            triggerContent={<ArrowLeftRight size={13} />} onChange={event => handlers.onSwap(metric.key, event.target.value)}>
            {handlers.replacements.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </Select></span>}
        <button className="analytics-kpi-remove" type="button" onClick={() => handlers.onRemove(metric.key)} aria-label={`Remover ${metric.label} da visão geral`}><X size={14} /></button>
      </div>}
    </div>
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

type Scope = { ids: string[]; data: AnalyticsDashboardData } | null;
export type ScopeLoader = (campaignIds: string[]) => Promise<{ ok: true; data: AnalyticsDashboardData } | { ok: false; message: string }>;

/** Situação da campanha para a tabela: Google pelo status configurado; Meta pelo status guardado (sem ele a coluna some). */
function campaignState(platform: "meta" | "google", status: string | null) {
  if (platform === "google") { const state = googleCampaignState(status); return { label: state.label, active: status === "ENABLED" }; }
  const state = classifyDelivery({ configured: status, status, issues: false, accountBlocked: false }, null);
  return { label: state.label, active: state.group === "active" };
}

/**
 * Painel completo de UMA conta (Meta ou Google Ads): indicadores com variação (removíveis, trocáveis e reordenáveis), seleção de
 * campanhas (quando há leitor), gráfico do período e tabela de campanhas ordenável. É o mesmo desenho para todas as plataformas.
 */
export function AccountInsights({ title, data: base, platform, optional, setOptional, scopeLoader, metricsMenu = true, showTitle = true, extraActions }: {
  /** Botões a mais na barra desta conta (ex.: Personalizar relatório). */ extraActions?: ReactNode;
  /** Nome da conta como título do bloco (desligado quando o nome já está no título da linha da plataforma). */ showTitle?: boolean;
  title: string; data: AnalyticsDashboardData; platform: "meta" | "google"; optional: string[]; setOptional: (update: (keys: string[]) => string[]) => void;
  scopeLoader?: ScopeLoader; metricsMenu?: boolean;
}) {
  const [scope, setScope] = useState<Scope>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const data = scope?.data ?? base;

  const metric = (key: string) => data.metrics.find(item => item.key === key);
  const fixed = FIXED_ACCOUNT_METRICS.flatMap(key => metric(key) ?? []);
  const optionalMetrics = optional.flatMap(key => metric(key) ?? []);
  const replacements = data.metrics.filter(item => !FIXED_ACCOUNT_METRICS.includes(item.key) && !optional.includes(item.key));
  const chartMetrics = [...fixed.filter(item => item.key === "spend"), ...data.metrics.filter(item => ["impressions", "link_clicks"].includes(item.key))];
  const [chartKey, setChartKey] = useState("spend");
  const [comparison, setComparison] = useState(true);
  const [chartType, setChartType] = useState<"line" | "bar">("bar");
  const main = chartMetrics.find(item => item.key === chartKey) ?? chartMetrics[0];
  const sort = useSort(["name"]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const handlers: KpiHandlers = {
    dragging, dropTarget, replacements,
    onDragStart: setDragging, onDragEnter: setDropTarget, onDragEnd: () => { setDragging(null); setDropTarget(null); },
    onDrop: target => {
      const source = dragging;
      setDragging(null); setDropTarget(null);
      if (!source || source === target) return;
      setOptional(keys => { const next = keys.filter(key => key !== source); next.splice(next.indexOf(target) + (keys.indexOf(source) < keys.indexOf(target) ? 1 : 0), 0, source); return next; });
    },
    onRemove: key => setOptional(keys => keys.filter(item => item !== key)),
    onSwap: (key, replacement) => { if (replacement) setOptional(keys => keys.includes(replacement) ? keys : keys.map(item => item === key ? replacement : item)); },
  };

  const hasStatus = base.campaigns.some(campaign => campaign.status);
  const allCampaigns = useMemo(() => {
    const list = base.campaigns.map(campaign => ({ ...campaign, active: campaignState(platform, campaign.status).active, spend: campaign.values.spend ?? null }));
    const ranked = rankCampaigns(list);
    // A seleção lista TODAS as campanhas da conta: primeiro as ativas e as que investiram, depois as demais.
    return [...ranked, ...list.filter(campaign => !ranked.includes(campaign))];
  }, [base.campaigns, platform]);
  const campaigns = useMemo(() => rankCampaigns(data.campaigns.map(campaign => ({
    ...campaign, state: campaignState(platform, campaign.status), active: campaignState(platform, campaign.status).active, spend: campaign.values.spend ?? null,
    result: resultBreakdown(campaign.values).sort((a, b) => b.value - a.value)[0] ?? null,
  }))), [data.campaigns, platform]);
  // Sem situação conhecida (Meta sem status guardado), todas as campanhas com investimento entram, da maior para a menor.
  const listed = hasStatus ? campaigns : [...data.campaigns.map(campaign => ({
    ...campaign, state: campaignState(platform, campaign.status), active: false, spend: campaign.values.spend ?? null,
    result: resultBreakdown(campaign.values).sort((a, b) => b.value - a.value)[0] ?? null,
  }))].filter(row => (row.spend ?? 0) > 0).sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const rows = sort.apply(listed, (row, key) => key === "name" ? row.name : key === "state" ? (row.active ? 0 : 1)
    : key === "result" ? row.result?.value ?? null : key === "cost" ? (row.result && row.spend != null && row.result.value > 0 ? row.spend / row.result.value : null) : (row.values[key] ?? null));
  const money = (value: number | null | undefined) => formatAnalyticsValue(value, numberMetric("spend", "currency"), data.currency);
  const th = (key: string, label: string, numeric = false) => <th scope="col" className={numeric ? "numeric" : undefined} aria-sort={sort.aria(key)}>{sort.head(key, label)}</th>;
  const filteredList = allCampaigns.filter(campaign => campaign.name.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR")));
  const idle = base.campaigns.length === 0 && !(base.summary.spend ?? 0);

  function openPicker() { setDraft(scope?.ids ?? allCampaigns.map(campaign => campaign.id)); setQuery(""); setError(""); setPicking(true); }
  function apply() {
    if (!draft.length || !scopeLoader) return;
    if (draft.length === allCampaigns.length) { setScope(null); setPicking(false); return; }
    setError("");
    startTransition(async () => {
      const result = await scopeLoader(draft);
      if (result.ok) { setScope({ ids: draft, data: result.data }); setPicking(false); } else setError(result.message);
    });
  }

  return <div className="platform-account-block">
    {showTitle && <h3 className="platform-account-name">{title}</h3>}
    {idle ? <p className="analytics-empty-copy">Nenhuma campanha encontrada nesta conta.</p> : <>
      {(scopeLoader || metricsMenu || extraActions) && <div className="analytics-section-toolbar" style={{ borderBottom: 0 }}>
        <span className="platform-heading-meta">{scope ? `${scope.ids.length} de ${allCampaigns.length} campanhas selecionadas` : "Todas as campanhas"}</span>
        <div className="analytics-toolbar-actions">
          {scope && <button type="button" className="analytics-button analytics-button-ghost" onClick={() => setScope(null)}><X size={14} />Limpar seleção</button>}
          {scopeLoader && <button type="button" className="analytics-button analytics-button-ghost" onClick={() => picking ? setPicking(false) : openPicker()} aria-expanded={picking}><BarChart3 size={15} />Selecionar campanhas</button>}
          {extraActions}
          {metricsMenu && <details className="analytics-filter-menu analytics-metric-menu">
            <summary><Filter size={14} />Métricas <span className="analytics-count">{FIXED_ACCOUNT_METRICS.length + optional.length}</span><ChevronDown size={13} /></summary>
            <div className="analytics-filter-popover">
              <div className="analytics-metric-picker-heading"><strong>Métricas da visão geral</strong>
                <button type="button" onClick={() => setOptional(() => DEFAULT_OPTIONAL_ACCOUNT_METRICS.filter(key => base.metrics.some(item => item.key === key)))}>Padrão</button></div>
              {data.metrics.map(item => <div className="analytics-metric-picker-row" key={item.key}>
                <label><input type="checkbox" checked={FIXED_ACCOUNT_METRICS.includes(item.key) || optional.includes(item.key)} disabled={FIXED_ACCOUNT_METRICS.includes(item.key)}
                  onChange={() => setOptional(keys => keys.includes(item.key) ? keys.filter(key => key !== item.key) : [...keys, item.key])} />
                  <span>{item.label}{FIXED_ACCOUNT_METRICS.includes(item.key) && <small>Fixa</small>}</span></label>
              </div>)}
            </div>
          </details>}
        </div>
      </div>}
      {picking && scopeLoader && <article className="analytics-card google-scope-panel" role="region" aria-label="Selecionar campanhas">
        <div className="panel-heading"><div><h2>Selecionar campanhas</h2><p>Os indicadores, o gráfico e a tabela passam a considerar só as campanhas marcadas.</p></div></div>
        <div className="google-scope-tools">
          <label className="analytics-search"><Search size={14} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar campanha" aria-label="Buscar campanha" /></label>
          <button type="button" className="analytics-text-button" onClick={() => setDraft(allCampaigns.map(campaign => campaign.id))}>Marcar todas</button>
          <button type="button" className="analytics-text-button" onClick={() => setDraft([])}>Desmarcar todas</button>
        </div>
        <ul className="google-scope-list">{filteredList.map(campaign => <li key={campaign.id}><label>
          <input type="checkbox" checked={draft.includes(campaign.id)} onChange={() => setDraft(keys => keys.includes(campaign.id) ? keys.filter(id => id !== campaign.id) : [...keys, campaign.id])} />
          <span>{campaign.name}<small>{hasStatus ? `${campaign.active ? "Ativa" : "Pausada"} · ` : ""}{money(campaign.spend)} no período</small></span></label></li>)}
          {!filteredList.length && <li className="muted">Nenhuma campanha encontrada.</li>}</ul>
        {error && <p role="alert" className="analytics-footnote">{error}</p>}
        <div className="google-scope-actions">
          <button type="button" className="analytics-button" onClick={() => setPicking(false)} disabled={pending}>Cancelar</button>
          <button type="button" className="analytics-button analytics-button-primary" onClick={apply} disabled={pending || !draft.length}>{pending ? "Aplicando…" : `Aplicar seleção (${draft.length})`}</button>
        </div>
      </article>}
      <div className="analytics-kpi-grid analytics-kpi-grid-fixed">{fixed.map(item => <Kpi key={item.key} data={data} metric={item} fixed />)}</div>
      <div className="analytics-kpi-flow">{optionalMetrics.map(item => <Kpi key={item.key} data={data} metric={item} fixed={false} handlers={handlers} />)}</div>
      {main && <article className="analytics-card analytics-evolution-card">
        <div className="analytics-chart-head">
          <div className="analytics-chart-head-top">
            <h3>{scope ? "Desempenho das campanhas selecionadas" : "Desempenho do período"}</h3>
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
        <div className="panel-heading"><div><h2>Campanhas</h2><p>{hasStatus ? "Ativas, em veiculação ou que investiram no período selecionado." : "Campanhas que investiram no período selecionado."}</p></div></div>
        {rows.length ? <div className="table-scroll"><table className="analytics-table analytics-campaign-table">
          <caption className="sr-only">Campanhas de {title}</caption>
          <thead><tr>{th("name", "Campanha")}{hasStatus && th("state", "Situação")}{th("spend", "Investimento", true)}{th("result", "Resultados", true)}{th("cost", "Custo por resultado", true)}{th("impressions", "Impressões", true)}{th("link_clicks", "Cliques", true)}{th("ctr_link", "CTR", true)}{th("cpc_link", "CPC", true)}</tr></thead>
          <tbody>{rows.map(row => {
            const cost = row.result && row.spend != null && row.result.value > 0 ? row.spend / row.result.value : null;
            return <tr key={row.id}>
              <th scope="row"><strong title={row.name}>{row.name}</strong></th>
              {hasStatus && <td><span className={`badge ${row.active ? "green" : "neutral"}`}><span className="status-dot" />{row.state.label}</span></td>}
              <td className="numeric">{money(row.spend)}</td>
              <td className="numeric">{row.result ? <span className="campaigns-result"><strong>{whole.format(row.result.value)}</strong><small>{row.result.label.toLocaleLowerCase("pt-BR")}</small></span> : <span className="muted">—</span>}</td>
              <td className="numeric">{row.result && cost != null ? <span className="campaigns-result"><strong>{money(cost)}</strong><small>Por {row.result.label.toLocaleLowerCase("pt-BR")}</small></span> : <span className="muted">—</span>}</td>
              <td className="numeric">{formatAnalyticsValue(row.values.impressions, numberMetric("impressions", "integer"), null)}</td>
              <td className="numeric">{formatAnalyticsValue(row.values.link_clicks, numberMetric("link_clicks", "integer"), null)}</td>
              <td className="numeric">{formatAnalyticsValue(row.values.ctr_link, numberMetric("ctr_link", "percent"), null)}</td>
              <td className="numeric">{money(row.values.cpc_link)}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="analytics-empty-copy">Nenhuma campanha ativa ou com investimento neste período.</p>}
      </article>
    </>}
  </div>;
}
