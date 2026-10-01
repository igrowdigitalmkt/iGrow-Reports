"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, CalendarRange, Check, ChevronDown, CircleDollarSign, Clock3, FileText, Filter, Info, Layers3, MousePointerClick, RefreshCw, Search, Sparkles, Target, TrendingUp, WalletCards } from "lucide-react";
import { collectDashboardData } from "./analytics-actions";
import { resolveAnalyticsRange } from "./range";
import type { AnalyticsDashboardData } from "./analytics-types";
import { ANALYTICS_COLORS, AnalyticsAccountChart, AnalyticsSparkline, AnalyticsTrendChart, formatAnalyticsValue, type AnalyticsMetric } from "./analytics-charts";
import "./analytics-dashboard.css";

type DashboardProps = { data: AnalyticsDashboardData; clientId: string; canCollect: boolean; agencyMode?: boolean };
const PERIODS = [{ key: "7d", label: "7 dias" }, { key: "30d", label: "30 dias" }, { key: "90d", label: "3 meses" }, { key: "180d", label: "6 meses" }, { key: "365d", label: "1 ano" }, { key: "custom", label: "Personalizado" }];
const DEFAULT_METRICS = ["spend", "impressions", "link_clicks", "primary_results", "ctr_link", "cost_per_result"];
const METRIC_ICONS = { spend: CircleDollarSign, impressions: TrendingUp, link_clicks: MousePointerClick, primary_results: Target };

function displayDate(value: string, includeYear = true) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", ...(includeYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function changeDescription(data: AnalyticsDashboardData, metric: AnalyticsMetric) {
  if (data.coverage.status !== "complete" || data.coverage.previousStatus !== "complete") return { text: "Comparação sem cobertura completa", direction: "neutral" };
  const current = data.summary[metric.key];
  const previous = data.previousSummary[metric.key];
  if (current == null || previous == null) return { text: "Comparação indisponível", direction: "neutral" };
  if (previous === 0) return { text: current === 0 ? "Sem variação no período" : "Anterior igual a zero", direction: "neutral" };
  const change = (current - previous) / Math.abs(previous) * 100;
  if (Math.abs(change) < .05) return { text: "Sem variação no período", direction: "neutral" };
  const desirable = metric.desirable === "neutral" ? "neutral" : (change > 0) === (metric.desirable === "up") ? "positive" : "negative";
  return { text: `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. anterior`, direction: desirable, up: change > 0 };
}

function makeObservations(data: AnalyticsDashboardData) {
  const observations: { title: string; text: string }[] = [];
  const spendMetric = data.metrics.find((metric) => metric.key === "spend");
  const resultMetric = data.metrics.find((metric) => metric.key === "primary_results");
  if (data.coverage.status === "empty") return [{ title: "Este período ainda precisa de dados", text: "Não há coleta disponível para as datas e contas selecionadas. Os indicadores permanecem indisponíveis até que a coleta seja concluída." }];
  const campaigns = data.campaigns.filter((campaign) => (campaign.values.spend ?? 0) > 0).sort((a, b) => (b.values.spend ?? 0) - (a.values.spend ?? 0));
  const spend = data.summary.spend;
  const top = campaigns[0];
  if (top && spend != null && spend > 0 && spendMetric) observations.push({ title: "Concentração do investimento", text: `${top.name} concentrou ${((top.values.spend ?? 0) / spend * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do investimento registrado: ${formatAnalyticsValue(top.values.spend, spendMetric, data.currency)}.` });
  if (resultMetric) {
    const withResults = data.campaigns.filter((campaign) => (campaign.values.primary_results ?? 0) > 0).sort((a, b) => (b.values.primary_results ?? 0) - (a.values.primary_results ?? 0));
    if (withResults[0]) observations.push({ title: `Destaque em ${resultMetric.label.toLocaleLowerCase("pt-BR")}`, text: `${withResults[0].name} registrou ${formatAnalyticsValue(withResults[0].values.primary_results, resultMetric, data.currency)} no intervalo. Compare investimento e custo por resultado antes de redistribuir orçamento.` });
  }
  const clicks = data.summary.link_clicks;
  const impressions = data.summary.impressions;
  if (clicks != null && impressions != null && impressions > 0) observations.push({ title: "Resposta aos anúncios", text: `Os anúncios receberam ${clicks.toLocaleString("pt-BR")} cliques no link em ${impressions.toLocaleString("pt-BR")} impressões. A taxa de cliques de link foi ${(clicks / impressions * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%.` });
  if (data.coverage.status === "partial") observations.push({ title: "Leitura parcial do período", text: `${data.coverage.coveredDays} de ${data.coverage.totalDays} dias possuem cobertura de coleta. Complete o histórico para avaliar tendências do intervalo inteiro.` });
  if (data.coverage.previousStatus !== "complete") observations.push({ title: "Histórico anterior em preparação", text: `A comparação de ${displayDate(data.previousDateFrom, false)} a ${displayDate(data.previousDateTo, false)} não possui cobertura completa. Variações percentuais não são exibidas para esse intervalo.` });
  return observations.slice(0, 4);
}

export function ClientAnalyticsDashboard({ data, clientId, canCollect, agencyMode = false }: DashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const [period, setPeriod] = useState(query.get("periodo") ?? "30d");
  const [from, setFrom] = useState(data.dateFrom);
  const [to, setTo] = useState(data.dateTo);
  const [accounts, setAccounts] = useState(data.selectedAccountIds);
  const [metricKeys, setMetricKeys] = useState<string[]>(DEFAULT_METRICS.filter((key) => data.metrics.some((metric) => metric.key === key)));
  const [tab, setTab] = useState("overview");
  const [campaignQuery, setCampaignQuery] = useState("");
  const [sortKey, setSortKey] = useState("spend");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [comparison, setComparison] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collectingComparison, setCollectingComparison] = useState(false);
  const [pending, startTransition] = useTransition();
  const [navigating, startNavigation] = useTransition();
  const selectedMetrics = data.metrics.filter((metric) => metricKeys.includes(metric.key));
  const spendMetric = data.metrics.find((metric) => metric.key === "spend");
  const primaryMetric = data.metrics.find((metric) => metric.key === "primary_results");
  const mainMetrics = [spendMetric, primaryMetric].filter((metric): metric is AnalyticsMetric => !!metric && metricKeys.includes(metric.key));
  if (!mainMetrics.length) mainMetrics.push(...selectedMetrics.slice(0, 2));
  const additionalMetrics = selectedMetrics.filter((metric) => !mainMetrics.some((main) => main.key === metric.key));
  const campaigns = useMemo(() => data.campaigns.filter((campaign) => `${campaign.name} ${campaign.accountName}`.toLocaleLowerCase("pt-BR").includes(campaignQuery.toLocaleLowerCase("pt-BR"))).sort((a, b) => {
    const av = a.values[sortKey];
    const bv = b.values[sortKey];
    if (av == null && bv == null) return a.name.localeCompare(b.name, "pt-BR");
    if (av == null) return 1;
    if (bv == null) return -1;
    return sortDirection === "desc" ? bv - av : av - bv;
  }), [data.campaigns, campaignQuery, sortKey, sortDirection]);
  const observations = makeObservations(data);
  const actions = data.metrics.filter((metric) => metric.key.startsWith("action:"));
  const latest = data.coverage.latestCollectedAt ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: data.timezoneName ?? "America/Sao_Paulo" }).format(new Date(data.coverage.latestCollectedAt)) : "Ainda não coletado";

  function navigate(nextPeriod: string, selectedAccounts = accounts, customFrom = from, customTo = to) {
    const next = new URLSearchParams();
    next.set("periodo", nextPeriod);
    if (nextPeriod === "custom") { next.set("from", customFrom); next.set("to", customTo); }
    if (selectedAccounts.length && selectedAccounts.length < data.accounts.length) next.set("accounts", selectedAccounts.join(","));
    startNavigation(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (data.accounts.length && !accounts.length) { setError("Selecione pelo menos uma conta de anúncios."); return; }
    if (period === "custom") {
      try {
        resolveAnalyticsRange({ periodo: "custom", from, to }, data.timezoneName ?? "America/Sao_Paulo");
      } catch (validationError) {
        setError(validationError instanceof Error ? validationError.message : "Escolha um período válido.");
        return;
      }
    }
    navigate(period);
  }

  function collect(range: "current" | "previous" = "current") {
    setError(""); setNotice("");
    setCollectingComparison(range === "previous");
    const collectFrom = range === "previous" ? data.previousDateFrom : data.dateFrom;
    const collectTo = range === "previous" ? data.previousDateTo : data.dateTo;
    startTransition(async () => {
      try {
        const result = await collectDashboardData({ clientId, from: collectFrom, to: collectTo });
        if (result.error) { setError(result.error); router.refresh(); return; }
        setNotice(range === "previous" ? "Coleta do período anterior concluída. A comparação foi atualizada." : "Coleta concluída para o período selecionado. Os dados foram atualizados.");
        router.refresh();
      } catch {
        setError("Não foi possível concluir a coleta. Confira a conexão Meta e tente novamente.");
      }
    });
  }

  function toggleMetric(key: string) {
    setMetricKeys((current) => current.includes(key) ? current.length > 1 ? current.filter((item) => item !== key) : current : [...current, key]);
  }

  function sortBy(key: string) {
    setSortDirection(sortKey === key && sortDirection === "desc" ? "asc" : "desc");
    setSortKey(key);
  }

  const summaryHref = `/dashboard/relatorios?clientId=${encodeURIComponent(clientId)}&periodo=custom&from=${data.dateFrom}&to=${data.dateTo}`;

  return <section className="analytics-dashboard" aria-label="Painel de desempenho Meta Ads" aria-busy={pending || navigating}>
    <div className="analytics-command-bar">
      <div className="analytics-title-block"><span className="analytics-eyebrow"><span className="analytics-live-dot" /> META ADS · VISÃO DE DESEMPENHO</span><h2>Os números por trás<br className="analytics-mobile-break" /> dos seus resultados<span>.</span></h2><p>Explore o período, acompanhe a evolução e encontre o que merece atenção.</p></div>
      <div className="analytics-command-actions">{agencyMode && <Link href={summaryHref} className="analytics-button analytics-button-secondary"><FileText size={15} /> Gerar resumo</Link>}{canCollect && <button type="button" className="analytics-button analytics-button-primary" onClick={() => collect()} disabled={pending || !data.accounts.length}><RefreshCw size={15} className={pending ? "analytics-spin" : ""} />{pending ? "Coletando dados…" : "Atualizar dados"}</button>}</div>
    </div>
    {agencyMode && data.selectedAccountIds.length < data.accounts.length && <p className="analytics-summary-scope">O resumo usa todas as contas do cliente. A seleção de contas abaixo filtra a análise neste painel.</p>}

    <form className="analytics-filter-bar" onSubmit={applyFilters}>
      <div className="analytics-period-options" aria-label="Período de análise">{PERIODS.map((item) => <button type="button" key={item.key} className={period === item.key ? "is-active" : ""} aria-pressed={period === item.key} onClick={() => { setPeriod(item.key); setError(""); if (item.key !== "custom") navigate(item.key); }}>{item.label}</button>)}</div>
      <div className="analytics-filter-fields"><label className="analytics-date-field"><CalendarRange size={14} /><span className="sr-only">Data inicial</span><input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPeriod("custom"); }} required /></label><span className="analytics-date-divider">até</span><label className="analytics-date-field"><span className="sr-only">Data final</span><input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPeriod("custom"); }} required /></label>
        {data.accounts.length > 1 && <details className="analytics-filter-menu"><summary><WalletCards size={14} />{accounts.length === data.accounts.length ? "Todas as contas" : `${accounts.length} contas`}<ChevronDown size={13} /></summary><div className="analytics-filter-popover"><strong>Contas de anúncios</strong>{data.accounts.map((account) => <label key={account.id}><input type="checkbox" checked={accounts.includes(account.id)} onChange={() => setAccounts((current) => current.includes(account.id) ? current.filter((id) => id !== account.id) : [...current, account.id])} /><span>{account.name}<small>{account.externalId}</small></span></label>)}</div></details>}
        <button type="submit" className="analytics-button analytics-button-apply" disabled={navigating}>{navigating ? "Aplicando…" : "Aplicar"}</button>
      </div>
    </form>

    <div className="analytics-context-strip"><span><CalendarRange size={13} /><strong>{displayDate(data.dateFrom)} – {displayDate(data.dateTo)}</strong></span><span><Clock3 size={13} />{data.timezoneName ?? "Fuso não informado"}</span><span>{data.currency ?? "Moeda não consolidada"}</span><span className="analytics-last-update"><span className="analytics-status-dot" />Última coleta: {latest}</span></div>

    {error && <div className="analytics-notice analytics-notice-error" role="alert"><Info size={17} /><p>{error}</p></div>}
    {notice && <div className="analytics-notice analytics-notice-success" role="status"><Check size={17} /><p>{notice}</p></div>}
    {pending && <div className="analytics-notice" role="status"><RefreshCw size={17} className="analytics-spin" /><p>Consultando a Meta e salvando os dados de {displayDate(collectingComparison ? data.previousDateFrom : data.dateFrom, false)} a {displayDate(collectingComparison ? data.previousDateTo : data.dateTo, false)}. Períodos longos podem levar alguns minutos.</p></div>}
    {data.warnings.map((warning, index) => <div className="analytics-notice" role="status" key={`${index}-${warning}`}><Info size={17} /><p>{warning}</p></div>)}
    {data.coverage.status !== "complete" && <div className="analytics-coverage-banner"><div><span className="analytics-coverage-icon"><Layers3 size={17} /></span><p><strong>{data.coverage.status === "empty" ? "Histórico ainda não coletado" : "Histórico parcial neste período"}</strong><span>{data.coverage.coveredDays} de {data.coverage.totalDays} dias com cobertura. Dias sem coleta aparecem como indisponíveis.</span></p></div>{canCollect && <button className="analytics-text-button" type="button" onClick={() => collect()} disabled={pending}>Coletar este período <ArrowUpRight size={14} /></button>}</div>}

    <div className="analytics-section-toolbar"><div className="analytics-tabs" role="tablist" aria-label="Seções do painel">{[{ key: "overview", label: "Visão geral", icon: Activity }, { key: "campaigns", label: "Campanhas", icon: BarChart3 }, { key: "metrics", label: "Todas as métricas", icon: Layers3 }].map(({ key, label, icon: Icon }) => <button type="button" role="tab" id={`analytics-tab-${key}`} aria-controls={`analytics-panel-${key}`} aria-selected={tab === key} key={key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}><Icon size={14} />{label}</button>)}</div>
      <details className="analytics-filter-menu analytics-metric-menu"><summary><Filter size={14} />Métricas <span className="analytics-count">{selectedMetrics.length}</span><ChevronDown size={13} /></summary><div className="analytics-filter-popover"><div className="analytics-metric-picker-heading"><strong>O que você quer analisar?</strong><div><button type="button" onClick={() => setMetricKeys(data.metrics.map((metric) => metric.key))}>Selecionar todas</button><button type="button" onClick={() => setMetricKeys(DEFAULT_METRICS.filter((key) => data.metrics.some((metric) => metric.key === key)))}>Essenciais</button></div></div>{data.metrics.map((metric) => <div className="analytics-metric-picker-row" key={metric.key}><label><input type="checkbox" checked={metricKeys.includes(metric.key)} onChange={() => toggleMetric(metric.key)} /><span>{metric.label}</span></label><button type="button" onClick={() => setMetricKeys([metric.key])} aria-label={`Analisar somente ${metric.label}`}>Somente</button></div>)}</div></details>
    </div>

    <div role="tabpanel" id={`analytics-panel-${tab}`} aria-labelledby={`analytics-tab-${tab}`}>
      {tab !== "campaigns" && <div className="analytics-kpi-grid">{(tab === "metrics" ? data.metrics : selectedMetrics).map((metric, index) => {
        const change = changeDescription(data, metric);
        const Icon = METRIC_ICONS[metric.key as keyof typeof METRIC_ICONS] ?? BarChart3;
        const color = ANALYTICS_COLORS[index % ANALYTICS_COLORS.length];
        return <article className="analytics-kpi" key={metric.key} style={{ "--metric-color": color } as CSSProperties}><div className="analytics-kpi-top"><span>{metric.label}</span><span className="analytics-kpi-icon"><Icon size={16} /></span></div><strong className={`analytics-kpi-value${data.summary[metric.key] == null ? " is-unavailable" : ""}`}>{formatAnalyticsValue(data.summary[metric.key], metric, data.currency)}</strong><div className={`analytics-kpi-change is-${change.direction}`}>{"up" in change ? change.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} /> : <span className="analytics-change-dash">—</span>}<span>{change.text}</span></div><AnalyticsSparkline values={data.daily.map((day) => day.values[metric.key])} color={color} /></article>;
      })}</div>}

      {tab === "overview" && <>
        <div className="analytics-primary-grid"><article className="analytics-card analytics-evolution-card"><div className="analytics-card-heading"><div><span className="analytics-card-kicker">EVOLUÇÃO NO TEMPO</span><h3>{mainMetrics.map((metric) => metric.label).join(" e ") || "Desempenho do período"}</h3></div><div className="analytics-comparison-controls"><label className="analytics-compare-toggle"><input type="checkbox" checked={comparison} onChange={(event) => setComparison(event.target.checked)} disabled={data.coverage.previousStatus !== "complete"} /><span>Comparar período</span></label>{canCollect && data.coverage.previousStatus !== "complete" && <button type="button" className="analytics-collect-comparison" onClick={() => collect("previous")} disabled={pending || !data.accounts.length}><RefreshCw size={11} /> Atualizar comparação</button>}</div></div><div className="analytics-chart-legend">{mainMetrics.map((metric, index) => <span key={metric.key}><i style={{ background: ANALYTICS_COLORS[index] }} />{metric.label}</span>)}{comparison && data.coverage.previousStatus === "complete" && <span><i className="analytics-dashed-legend" />Anterior · {displayDate(data.previousDateFrom, false)}–{displayDate(data.previousDateTo, false)}</span>}</div>{mainMetrics.length ? <AnalyticsTrendChart data={data} metrics={mainMetrics} comparison={comparison} height={300} /> : <p className="analytics-empty-copy">Nenhuma métrica disponível para o gráfico.</p>}</article>
          <article className="analytics-card analytics-account-card"><div className="analytics-card-heading"><div><span className="analytics-card-kicker">DISTRIBUIÇÃO</span><h3>Investimento por conta</h3></div><WalletCards size={17} /></div>{spendMetric && <AnalyticsAccountChart data={data} metric={spendMetric} />}</article></div>

        {!!additionalMetrics.length && <div className="analytics-metric-charts analytics-selected-charts">{additionalMetrics.map((metric) => <article className="analytics-card" key={metric.key}><div className="analytics-card-heading"><div><span className="analytics-card-kicker">EVOLUÇÃO DIÁRIA</span><h3>{metric.label}</h3></div><strong className="analytics-small-total">{formatAnalyticsValue(data.summary[metric.key], metric, data.currency)}</strong></div><AnalyticsTrendChart data={data} metrics={[metric]} comparison={comparison} height={185} /></article>)}</div>}

        <div className="analytics-insights-grid"><article className="analytics-card analytics-observations"><div className="analytics-card-heading"><div><span className="analytics-card-kicker">LEITURA DOS DADOS</span><h3>O que merece atenção</h3></div><Sparkles size={17} /></div><div className="analytics-observation-list">{observations.map((item, index) => <div className="analytics-observation" key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h4>{item.title}</h4><p>{item.text}</p></div></div>)}</div><p className="analytics-footnote">Observações calculadas sobre os dados coletados. Elas descrevem o período e não atribuem causas ao desempenho.</p></article>
          <article className="analytics-card analytics-results-card"><div className="analytics-card-heading"><div><span className="analytics-card-kicker">AÇÕES INFORMADAS PELA META</span><h3>Resultados em detalhe</h3></div><Target size={17} /></div><div className="analytics-action-list">{actions.length ? actions.map((metric) => <div key={metric.key}><span>{metric.label}{metric.key === `action:${data.primaryActionType}` && <small>Resultado principal</small>}</span><strong>{formatAnalyticsValue(data.summary[metric.key], metric, data.currency)}</strong></div>) : <p className="analytics-empty-copy">Sem ações disponíveis neste período.</p>}</div><p className="analytics-footnote">Tipos de ação podem se sobrepor. Não são somados como um total único de conversões.</p></article></div>
      </>}

      {tab === "metrics" && <div className="analytics-metric-charts">{data.metrics.map((metric) => <article className="analytics-card" key={metric.key}><div className="analytics-card-heading"><div><span className="analytics-card-kicker">EVOLUÇÃO DIÁRIA</span><h3>{metric.label}</h3></div><strong className="analytics-small-total">{formatAnalyticsValue(data.summary[metric.key], metric, data.currency)}</strong></div><AnalyticsTrendChart data={data} metrics={[metric]} comparison={comparison} height={210} /></article>)}</div>}

      {tab !== "metrics" && <article className="analytics-card analytics-campaign-card"><div className="analytics-card-heading"><div><span className="analytics-card-kicker">DESEMPENHO DAS CAMPANHAS</span><h3>De onde vêm os resultados <span className="analytics-count">{campaigns.length}</span></h3></div><label className="analytics-search"><Search size={14} /><input type="search" value={campaignQuery} onChange={(event) => setCampaignQuery(event.target.value)} placeholder="Buscar campanha…" aria-label="Buscar campanha ou conta" /></label></div><div className="analytics-table-scroll"><table className="analytics-table analytics-campaign-table"><caption className="sr-only">Métricas por campanha do período selecionado. Clique no cabeçalho para ordenar.</caption><thead><tr><th scope="col">Campanha / conta</th>{selectedMetrics.map((metric) => <th scope="col" key={metric.key} aria-sort={sortKey === metric.key ? sortDirection === "asc" ? "ascending" : "descending" : "none"}><button type="button" onClick={() => sortBy(metric.key)}>{metric.label}{sortKey === metric.key && <ChevronDown size={12} style={{ transform: sortDirection === "asc" ? "rotate(180deg)" : undefined }} />}</button></th>)}</tr></thead><tbody>{campaigns.map((campaign, index) => <tr key={campaign.id}><th scope="row"><div className="analytics-campaign-name"><span className="analytics-campaign-mark" style={{ color: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] }}><BarChart3 size={15} /></span><div><strong>{campaign.name}</strong><small>{campaign.accountName}</small></div></div></th>{selectedMetrics.map((metric) => <td key={metric.key}>{formatAnalyticsValue(campaign.values[metric.key], metric, campaign.currency || data.currency)}</td>)}</tr>)}</tbody></table></div>{!campaigns.length && <p className="analytics-empty-copy">{campaignQuery ? "Nenhuma campanha corresponde à busca." : "Nenhuma campanha coletada para este período."}</p>}<p className="analytics-footnote">CTR, CPC e CPM são recalculados pelos totais da campanha. Receita e ROAS, quando disponíveis, são atribuições da Meta.</p></article>}
    </div>

    <footer className="analytics-data-footer"><span><Check size={12} />Dados da Meta · calendário local de cada conta</span><span>Sem estimativas para datas não coletadas</span></footer>
  </section>;
}
