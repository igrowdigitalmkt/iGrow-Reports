"use client";

import Link from "next/link";
import { CampaignTree } from "./campaign-tree";
import { compactEntitySelection, leafKeys, type AnalyticsEntity } from "./analytics-hierarchy";
import { downloadDashboardPdf, downloadSavedReportPdf } from "@/modules/reports/pdf-download";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, CalendarRange, Check, ChevronDown,
  CircleDollarSign, Clock3, Download, FileText, Filter, Info, Layers3, Lock,
  MousePointerClick, RefreshCw, Search, Sparkles, Target, Trash2, TrendingUp,
  WalletCards, X,
} from "lucide-react";
import { collectDashboardData } from "./analytics-actions";
import { getCampaignScopedAnalytics } from "./analytics-scope-actions";
import { deleteDashboardReport, generateDashboardReport } from "./report-actions";
import { publishReportVersion } from "@/modules/reports/actions";
import { resolveAnalyticsRange } from "./range";
import type { AnalyticsDashboardData, AnalyticsReportItem } from "./analytics-types";
import {
  ANALYTICS_COLORS, AnalyticsAccountChart, AnalyticsSparkline, AnalyticsTrendChart,
  formatAnalyticsValue, type AnalyticsMetric,
} from "./analytics-charts";
import "./analytics-dashboard.css";
type DashboardProps = {
  data: AnalyticsDashboardData;
  entities: AnalyticsEntity[]; workspaceName: string; clientName: string;
  clientId: string;
  workspaceId: string;
  canCollect: boolean;
  canManageReports: boolean;
  reports: AnalyticsReportItem[];
  preferenceKey: string;
};

const PERIODS = [
  { key: "7d", label: "7 dias" }, { key: "30d", label: "30 dias" },
  { key: "90d", label: "3 meses" }, { key: "180d", label: "6 meses" },
  { key: "365d", label: "1 ano" }, { key: "custom", label: "Personalizado" },
];
const FIXED_METRICS = ["spend", "reach", "impressions", "cpm", "primary_results", "cost_per_result"];
const FIXED_METRIC_LABELS: Record<string, string> = {
  spend: "Investimento",
  reach: "Alcance",
  impressions: "Impressões",
  cpm: "CPM",
  primary_results: "Resultados",
  cost_per_result: "Custo por resultado",
};
const DEFAULT_OPTIONAL_METRICS = ["link_clicks", "ctr_link", "cpc_link", "frequency", "clicks", "inline_post_engagement"];
const METRIC_ICONS = {
  spend: CircleDollarSign, impressions: TrendingUp, link_clicks: MousePointerClick,
  primary_results: Target, reach: Activity, cpm: BarChart3, cost_per_result: CircleDollarSign,
};

function displayDate(value: string, includeYear = true) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", ...(includeYear ? { year: "numeric" } : {}), timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
function changeDescription(data: AnalyticsDashboardData, metric: AnalyticsMetric) {
  if (data.coverage.status !== "complete" || data.coverage.previousStatus !== "complete") {
    return { text: "Comparação sem cobertura completa", direction: "neutral" };
  }
  const current = data.summary[metric.key];
  const previous = data.previousSummary[metric.key];
  if (current == null || previous == null) return { text: "Comparação indisponível", direction: "neutral" };
  if (previous === 0) return { text: current === 0 ? "Sem variação no período" : "Anterior igual a zero", direction: "neutral" };
  const change = (current - previous) / Math.abs(previous) * 100;
  if (Math.abs(change) < .05) return { text: "Sem variação no período", direction: "neutral" };
  const desirable = metric.desirable === "neutral"
    ? "neutral"
    : (change > 0) === (metric.desirable === "up") ? "positive" : "negative";
  return {
    text: `${change > 0 ? "+" : ""}${change.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. anterior`,
    direction: desirable, up: change > 0,
  };
}

function metricGroup(metric: AnalyticsMetric) {
  if (["spend", "cpc_link", "cpm", "cost_per_result", "attributed_revenue", "roas"].includes(metric.key)) return "Investimento e eficiência";
  if (["impressions", "reach", "frequency", "unique_clicks"].includes(metric.key)) return "Entrega e alcance";
  if (["link_clicks", "ctr_link", "clicks", "outbound_clicks"].includes(metric.key)) return "Cliques e tráfego";
  if (metric.key.includes("video")) return "Vídeo";
  if (metric.key.startsWith("action:") || metric.key === "primary_results") return "Resultados e ações";
  return "Engajamento e outros";
}
function makeObservations(data: AnalyticsDashboardData) {
  const observations: { title: string; text: string }[] = [];
  if (data.coverage.status === "empty") {
    return [{ title: "Este período ainda precisa de dados", text: "Não há coleta concluída para as datas e contas selecionadas." }];
  }
  const campaigns = data.campaigns
    .filter((campaign) => (campaign.values.spend ?? 0) > 0)
    .sort((a, b) => (b.values.spend ?? 0) - (a.values.spend ?? 0));
  const spend = data.summary.spend;
  if (campaigns[0] && spend != null && spend > 0) {
    observations.push({
      title: "Concentração do investimento",
      text: `${campaigns[0].name} concentrou ${((campaigns[0].values.spend ?? 0) / spend * 100)
        .toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do investimento do período.`,
    });
  }
  const clicks = data.summary.link_clicks;
  const impressions = data.summary.impressions;
  if (clicks != null && impressions != null && impressions > 0) {
    observations.push({
      title: "Resposta aos anúncios",
      text: `${clicks.toLocaleString("pt-BR")} cliques no link em ${impressions.toLocaleString("pt-BR")} impressões.`,
    });
  }
  return observations.slice(0, 4);
}
export function ClientAnalyticsDashboard({
  data, entities, workspaceName, clientName, clientId, workspaceId, canCollect, canManageReports, reports, preferenceKey,
}: DashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const [period, setPeriod] = useState(query.get("periodo") ?? "30d");
  const [from, setFrom] = useState(data.dateFrom);
  const [to, setTo] = useState(data.dateTo);
  const [accounts, setAccounts] = useState(data.selectedAccountIds);
  const [optionalMetricKeys, setOptionalMetricKeys] = useState<string[]>(
    DEFAULT_OPTIONAL_METRICS.filter((key) => data.metrics.some((metric) => metric.key === key)),
  );
  const [campaignMetricKeys, setCampaignMetricKeys] = useState<string[]>(
    ["spend", "impressions", "link_clicks", "primary_results", "cost_per_result"]
      .filter((key) => data.metrics.some((metric) => metric.key === key)),
  );
  const [draggedMetricKey, setDraggedMetricKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "campaigns" | "metrics" | "reports">("overview");
  const [campaignQuery, setCampaignQuery] = useState("");
  const roots = entities.filter(entity => entity.level === "campaign");
  const allLeaves = roots.flatMap(entity => leafKeys(entity, entities));
  const [selectedLeaves, setSelectedLeaves] = useState(allLeaves);
  const [appliedEntityKeys, setAppliedEntityKeys] = useState(roots.map(entity => entity.key));
  const draftEntityKeys = compactEntitySelection(entities, selectedLeaves);
  const scopeDirty = [...draftEntityKeys].sort().join(",") !== [...appliedEntityKeys].sort().join(",");
  const [scopeData, setScopeData] = useState<Pick<AnalyticsDashboardData, "summary" | "previousSummary" | "daily" | "previousDaily" | "coverage"> | null>(null);
  const [sortKey, setSortKey] = useState("spend");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [comparison, setComparison] = useState(true);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collectingComparison, setCollectingComparison] = useState(false);
  const [headerName, setHeaderName] = useState(workspaceName);
  const [headerDetails, setHeaderDetails] = useState("");
  const [reportTitle, setReportTitle] = useState("Relatório de performance");
  const [reportSearch, setReportSearch] = useState("");
  const [reportState, setReportState] = useState("all");
  const [pending, startTransition] = useTransition();
  const [navigating, startNavigation] = useTransition();
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(`igrow:analytics:${preferenceKey}`);
        if (saved) {
          const parsed = JSON.parse(saved) as { overview?: string[]; campaign?: string[] };
          const available = new Set(data.metrics.map((metric) => metric.key));
          if (Array.isArray(parsed.overview)) {
            setOptionalMetricKeys(parsed.overview.filter((key) => available.has(key) && !FIXED_METRICS.includes(key)));
          }
          if (Array.isArray(parsed.campaign)) {
            const valid = parsed.campaign.filter((key) => available.has(key));
            if (valid.length) setCampaignMetricKeys(valid);
          }
        }
      } catch {
        // Preferências locais inválidas não bloqueiam o dashboard.
      } finally {
        setPreferencesLoaded(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data.metrics, preferenceKey]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try { window.localStorage.setItem(`igrow:analytics:${preferenceKey}`, JSON.stringify({
      overview: optionalMetricKeys,
      campaign: campaignMetricKeys,
    })); } catch { /* Armazenamento local bloqueado não impede a análise. */ }
  }, [campaignMetricKeys, optionalMetricKeys, preferenceKey, preferencesLoaded]);

  const selectedEntities = entities.filter(entity => appliedEntityKeys.includes(entity.key));
  const scopedData = { ...data, ...(scopeData ?? {}), campaigns: selectedEntities.map(entity => ({
    id: entity.id, name: entity.name, accountId: entity.accountId, accountName: entity.accountName,
    currency: entity.currency, status: null, values: entity.values,
  })) };
  const fixedMetrics = FIXED_METRICS.map((key) => data.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is AnalyticsMetric => !!metric);
  const optionalMetrics = data.metrics.filter((metric) => optionalMetricKeys.includes(metric.key) && !FIXED_METRICS.includes(metric.key));
  const overviewMetrics = [...fixedMetrics, ...optionalMetrics];
  const campaignMetrics = campaignMetricKeys
    .map((key) => data.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is AnalyticsMetric => !!metric);
  const mainMetrics = [
    data.metrics.find((metric) => metric.key === "spend"),
    data.metrics.find((metric) => metric.key === "primary_results"),
  ].filter((metric): metric is AnalyticsMetric => !!metric);
  const spendMetric = data.metrics.find((metric) => metric.key === "spend");
  const actions = data.metrics.filter((metric) => metric.key.startsWith("action:"));
  const latest = data.coverage.latestCollectedAt
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: data.timezoneName ?? "America/Sao_Paulo",
      }).format(new Date(data.coverage.latestCollectedAt))
    : "Ainda não coletado";
  const visibleCampaigns = roots.filter(entity => {
    const descendants = entities.filter(item => item.campaignId === entity.id || item.key === entity.key);
    return [entity, ...descendants].some(item => item.name.toLocaleLowerCase("pt-BR").includes(campaignQuery.toLocaleLowerCase("pt-BR")));
  }).sort((a,b) => sortDirection === "desc"
    ? (b.values[sortKey] ?? -Infinity) - (a.values[sortKey] ?? -Infinity)
    : (a.values[sortKey] ?? Infinity) - (b.values[sortKey] ?? Infinity));

  const reportRows = useMemo(() => reports.filter((report) =>
    (reportState === "all" || report.state === reportState) &&
    `${report.title} ${report.dateFrom} ${report.dateTo}`.toLocaleLowerCase("pt-BR")
      .includes(reportSearch.toLocaleLowerCase("pt-BR"))
  ), [reports, reportSearch, reportState]);

  const selectedTimezones = new Set(data.accounts
    .filter((account) => data.selectedAccountIds.includes(account.id))
    .map((account) => account.timezoneName));
  const timezoneLabel = selectedTimezones.size > 1
    ? `${selectedTimezones.size} fusos`
    : [...selectedTimezones][0] ?? data.timezoneName ?? "Fuso não informado";
  const observations = makeObservations(scopedData);

  function navigate(nextPeriod: string, selectedAccounts = accounts, customFrom = from, customTo = to) {
    const next = new URLSearchParams();
    next.set("periodo", nextPeriod);
    if (nextPeriod === "custom") {
      next.set("from", customFrom);
      next.set("to", customTo);
    }
    if (selectedAccounts.length && selectedAccounts.length < data.accounts.length) {
      next.set("accounts", selectedAccounts.join(","));
    }
    startNavigation(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (data.accounts.length && !accounts.length) {
      setError("Selecione pelo menos uma conta de anúncios.");
      return;
    }
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
      const result = await collectDashboardData({ clientId, from: collectFrom, to: collectTo });
      if (result.error) {
        setError(result.error ?? "Não foi possível concluir esta ação.");
        router.refresh();
        return;
      }
      setNotice(range === "previous"
        ? "Período anterior atualizado."
        : "Dados atualizados para o período selecionado.");
      setScopeData(null);
      router.refresh();
    });
  }

  function toggleMetric(key: string) {
    if (FIXED_METRICS.includes(key)) return;
    setOptionalMetricKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  function toggleCampaignMetric(key: string) {
    setCampaignMetricKeys((current) =>
      current.includes(key)
        ? current.length > 1 ? current.filter((item) => item !== key) : current
        : [...current, key]
    );
  }

  function moveCampaignMetric(targetKey: string) {
    if (!draggedMetricKey || draggedMetricKey === targetKey) return;
    setCampaignMetricKeys((current) => {
      const next = current.filter((key) => key !== draggedMetricKey);
      const targetIndex = next.indexOf(targetKey);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggedMetricKey);
      return next;
    });
    setDraggedMetricKey(null);
  }

  function applyCampaignScope() {
    setError(""); setNotice("");
    if (!draftEntityKeys.length) { setError("Selecione ao menos uma campanha, conjunto ou anúncio."); return; }
    const nextKeys = [...draftEntityKeys];
    if (selectedLeaves.length === allLeaves.length) {
      setScopeData(null); setAppliedEntityKeys(nextKeys); setTab("overview"); return;
    }
    startTransition(async () => {
      const result = await getCampaignScopedAnalytics({ clientId, dateFrom: data.dateFrom, dateTo: data.dateTo,
        accountIds: data.selectedAccountIds, entityKeys: nextKeys });
      if ("error" in result) { setError(result.error ?? "Não foi possível aplicar a seleção."); return; }
      setScopeData({ summary: result.summary, previousSummary: result.previousSummary, daily: result.daily, previousDaily: result.previousDaily, coverage: result.coverage });
      setAppliedEntityKeys(nextKeys); setTab("overview");
    });
  }

  async function exportPdf() {
    try {
      await downloadDashboardPdf({ title: reportTitle, clientName, workspaceName: headerName || workspaceName,
        headerDetails, data: scopedData, metrics: overviewMetrics,
        entityLabels: scopeData ? selectedEntities.map(entity => entity.name) : ["Todas as campanhas"],
        accountLabels: data.accounts.filter(account => data.selectedAccountIds.includes(account.id)).map(account => account.name),
        comparison, chartType, entityRows: selectedEntities, campaignMetrics });
    } catch { setError("Não foi possível gerar o PDF. Tente novamente."); }
  }

  function downloadReport(reportVersionId: string) {
    startTransition(async () => {
      try { await downloadSavedReportPdf(clientId, reportVersionId); }
      catch { setError("Não foi possível baixar este relatório."); }
    });
  }

  function sortBy(key: string) {
    setSortDirection(sortKey === key && sortDirection === "desc" ? "asc" : "desc");
    setSortKey(key);
  }

  function generateReport() {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await generateDashboardReport({
        clientId,
        dateFrom: data.dateFrom,
        dateTo: data.dateTo,
        accountIds: data.selectedAccountIds,
        metricKeys: overviewMetrics.map((metric) => metric.key),
        entityKeys: scopeData ? appliedEntityKeys : [],
        header: { name: headerName, details: headerDetails }, comparison, chartType, campaignMetricKeys,
        title: reportTitle,
      });
      if ("error" in result) {
        setError(result.error ?? "Não foi possível concluir esta ação.");
        return;
      }
      setNotice("Relatório gerado. Revise e publique quando estiver pronto.");
      router.refresh();
    });
  }

  function publishReport(reportVersionId: string) {
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await publishReportVersion({ agencyId: workspaceId, reportVersionId });
      if ("error" in result) {
        setError(result.error ?? "Não foi possível concluir esta ação.");
        return;
      }
      setNotice("Relatório publicado na Área do Cliente.");
      router.refresh();
    });
  }

  function deleteReport(reportId: string) {
    if (!window.confirm("Excluir este relatório da área de relatórios? Ele deixará de ficar disponível para o cliente.")) return;
    setError(""); setNotice("");
    startTransition(async () => {
      const result = await deleteDashboardReport({ clientId, reportId });
      if ("error" in result) {
        setError(result.error ?? "Não foi possível concluir esta ação.");
        return;
      }
      setNotice("Relatório excluído.");
      router.refresh();
    });
  }

  return <section className="analytics-dashboard" aria-label="Painel de desempenho" aria-busy={pending || navigating}>
    <div className="analytics-command-bar">
      <div className="analytics-title-block">
        <span className="analytics-eyebrow"><span className="analytics-live-dot" /> DESEMPENHO · META ADS</span>
        <h2>Os números por trás<br className="analytics-mobile-break" /> dos seus resultados<span>.</span></h2>
        <p>Explore o período, personalize a análise e escolha exatamente o que deseja acompanhar.</p>
      </div>
      <div className="analytics-command-actions">
        {canCollect && <button type="button" className="analytics-button analytics-button-primary"
          onClick={() => collect()} disabled={pending || !data.accounts.length}>
          <RefreshCw size={15} className={pending ? "analytics-spin" : ""} />
          {pending ? "Atualizando…" : "Atualizar dados"}
        </button>}
      </div>
    </div>

    <form className="analytics-filter-bar" onSubmit={applyFilters}>
      <div className="analytics-period-options" aria-label="Período de análise">
        {PERIODS.map((item) => <button type="button" key={item.key}
          className={period === item.key ? "is-active" : ""} aria-pressed={period === item.key}
          onClick={() => {
            setPeriod(item.key); setError("");
            if (item.key !== "custom") navigate(item.key);
          }}>{item.label}</button>)}
      </div>
      <div className="analytics-filter-fields">
        <label className="analytics-date-field"><CalendarRange size={14} />
          <span className="sr-only">Data inicial</span>
          <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPeriod("custom"); }} required />
        </label>
        <span className="analytics-date-divider">até</span>
        <label className="analytics-date-field">
          <span className="sr-only">Data final</span>
          <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPeriod("custom"); }} required />
        </label>
        {data.accounts.length > 1 && <details className="analytics-filter-menu">
          <summary><WalletCards size={14} />{accounts.length === data.accounts.length ? "Todas as contas" : `${accounts.length} contas`}<ChevronDown size={13} /></summary>
          <div className="analytics-filter-popover"><strong>Contas de anúncios</strong>
            {data.accounts.map((account) => <label key={account.id}>
              <input type="checkbox" checked={accounts.includes(account.id)}
                onChange={() => setAccounts((current) => current.includes(account.id)
                  ? current.filter((id) => id !== account.id) : [...current, account.id])} />
              <span>{account.name}<small>{account.externalId}</small></span>
            </label>)}
          </div>
        </details>}
        <button type="submit" className="analytics-button analytics-button-apply" disabled={navigating}>
          {navigating ? "Aplicando…" : "Aplicar"}
        </button>
      </div>
    </form>
    <div className="analytics-context-strip">
      <span><CalendarRange size={13} /><strong>{displayDate(data.dateFrom)} – {displayDate(data.dateTo)}</strong></span>
      <span title={[...selectedTimezones].join(" · ")}><Clock3 size={13} />{timezoneLabel}</span>
      <span>{data.currency ?? "Moeda não consolidada"}</span>
      {!!data.warnings.length && <details className="analytics-quality-menu">
        <summary><Info size={13} />Qualidade dos dados <span className="analytics-count">{data.warnings.length}</span></summary>
        <div>{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
      </details>}
      <span className="analytics-last-update"><span className="analytics-status-dot" />Última coleta: {latest}</span>
    </div>

    {error && <div className="analytics-notice analytics-notice-error" role="alert"><Info size={17} /><p>{error}</p></div>}
    {notice && <div className="analytics-notice analytics-notice-success" role="status"><Check size={17} /><p>{notice}</p></div>}
    {pending && collectingComparison && <div className="analytics-notice" role="status">
      <RefreshCw size={17} className="analytics-spin" /><p>Atualizando o período anterior para comparação.</p>
    </div>}
    {scopedData.coverage.status !== "complete" && <div className="analytics-coverage-banner">
      <div><span className="analytics-coverage-icon"><Layers3 size={17} /></span><p>
        <strong>{scopedData.coverage.status === "empty" ? "Histórico ainda não coletado" : "Histórico parcial"}</strong>
        <span>{scopedData.coverage.coveredDays} de {scopedData.coverage.totalDays} dias com cobertura.</span>
      </p></div>
      {canCollect && <button className="analytics-text-button" type="button" onClick={() => collect()} disabled={pending}>
        Coletar este período <ArrowUpRight size={14} />
      </button>}
    </div>}
    <div className="analytics-section-toolbar">
      <div className="analytics-tabs" role="tablist" aria-label="Seções do painel">
        {[
          { key: "overview", label: "Visão geral", icon: Activity },
          { key: "campaigns", label: "Campanhas", icon: BarChart3 },
          { key: "metrics", label: "Todas as métricas", icon: Layers3 },
          { key: "reports", label: "Relatórios", icon: FileText },
        ].map(({ key, label, icon: Icon }) => <button type="button" role="tab"
          id={`analytics-tab-${key}`} aria-controls={`analytics-panel-${key}`}
          aria-selected={tab === key} key={key} className={tab === key ? "is-active" : ""}
          onClick={() => setTab(key as typeof tab)}><Icon size={14} />{label}</button>)}
      </div>
      {tab === "overview" && <details className="analytics-filter-menu analytics-metric-menu">
        <summary><Filter size={14} />Métricas <span className="analytics-count">{overviewMetrics.length}</span><ChevronDown size={13} /></summary>
        <div className="analytics-filter-popover">
          <div className="analytics-metric-picker-heading"><strong>Métricas da Visão geral</strong>
            <button type="button" onClick={() => setOptionalMetricKeys(DEFAULT_OPTIONAL_METRICS.filter((key) => data.metrics.some((metric) => metric.key === key)))}>Padrão</button>
          </div>
          {data.metrics.map((metric) => <div className="analytics-metric-picker-row" key={metric.key}>
            <label><input type="checkbox" checked={FIXED_METRICS.includes(metric.key) || optionalMetricKeys.includes(metric.key)}
              disabled={FIXED_METRICS.includes(metric.key)} onChange={() => toggleMetric(metric.key)} />
              <span>{metric.label}{FIXED_METRICS.includes(metric.key) && <small>Fixa</small>}</span></label>
          </div>)}
        </div>
      </details>}
      {tab === "campaigns" && <details className="analytics-filter-menu analytics-metric-menu">
        <summary><Filter size={14} />Colunas <span className="analytics-count">{campaignMetrics.length}</span><ChevronDown size={13} /></summary>
        <div className="analytics-filter-popover">
          <div className="analytics-metric-picker-heading"><strong>Métricas da tabela</strong>
            <span className="muted text-[9px]">Arraste os cabeçalhos para reordenar</span>
          </div>
          {data.metrics.map((metric) => <div className="analytics-metric-picker-row" key={metric.key}>
            <label><input type="checkbox" checked={campaignMetricKeys.includes(metric.key)}
              onChange={() => toggleCampaignMetric(metric.key)} /><span>{metric.label}</span></label>
          </div>)}
        </div>
      </details>}
    </div>
    <div role="tabpanel" id={`analytics-panel-${tab}`} aria-labelledby={`analytics-tab-${tab}`}>
      {tab === "overview" && <>
        <div className="analytics-kpi-grid analytics-kpi-grid-fixed">
          {fixedMetrics.map((metric, index) => {
            const change = changeDescription(scopedData, metric);
            const color = ANALYTICS_COLORS[index % ANALYTICS_COLORS.length];
            return <article className="analytics-kpi is-fixed" key={metric.key}
              style={{ "--metric-color": color } as CSSProperties}>
              <div className="analytics-kpi-top"><span title={metric.key === "cpm" ? "Custo por mil impressões" : undefined}>{FIXED_METRIC_LABELS[metric.key] ?? metric.label}</span><span className="analytics-kpi-icon" title="Indicador fixo"><Lock size={14} /></span></div>
              <strong className={`analytics-kpi-value${scopedData.summary[metric.key] == null ? " is-unavailable" : ""}`}>
                {formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}
              </strong>
              <div className={`analytics-kpi-change is-${change.direction}`}>
                {"up" in change ? change.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} /> : <span className="analytics-change-dash">—</span>}
                <span>{change.text}</span>
              </div>
              <AnalyticsSparkline values={scopedData.daily.map((day) => day.values[metric.key])} color={color} />
            </article>;
          })}
        </div>
        {!!optionalMetrics.length && <div className="analytics-kpi-grid analytics-kpi-grid-optional">
          {optionalMetrics.map((metric, index) => {
            const change = changeDescription(scopedData, metric);
            const Icon = METRIC_ICONS[metric.key as keyof typeof METRIC_ICONS] ?? BarChart3;
            const color = ANALYTICS_COLORS[(index + fixedMetrics.length) % ANALYTICS_COLORS.length];
            return <article className="analytics-kpi is-removable" key={metric.key}
              style={{ "--metric-color": color } as CSSProperties}>
              <div className="analytics-kpi-top"><span>{metric.label}</span>
                <button className="analytics-kpi-remove" type="button" onClick={() => toggleMetric(metric.key)}
                  aria-label={`Remover ${metric.label} da visão geral`}><X size={14} /></button>
                <span className="analytics-kpi-icon"><Icon size={16} /></span>
              </div>
              <strong className={`analytics-kpi-value${scopedData.summary[metric.key] == null ? " is-unavailable" : ""}`}>
                {formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}
              </strong>
              <div className={`analytics-kpi-change is-${change.direction}`}>
                {"up" in change ? change.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} /> : <span className="analytics-change-dash">—</span>}
                <span>{change.text}</span>
              </div>
              <AnalyticsSparkline values={scopedData.daily.map((day) => day.values[metric.key])} color={color} />
            </article>;
          })}
        </div>}
        <div className="analytics-primary-grid">
          <article className="analytics-card analytics-evolution-card">
            <div className="analytics-card-heading"><div><span className="analytics-card-kicker">EVOLUÇÃO NO TEMPO</span>
              <h3>{scopeData ? "Desempenho das campanhas selecionadas" : "Desempenho do período"}</h3></div>
              <div className="analytics-chart-view-controls"><div className="analytics-chart-switcher" role="group" aria-label="Tipo de gráfico">
                <button type="button" aria-pressed={chartType === "line"} className={chartType === "line" ? "is-active" : ""}
                  onClick={() => setChartType("line")}><TrendingUp size={12} />Linhas</button>
                <button type="button" aria-pressed={chartType === "bar"} className={chartType === "bar" ? "is-active" : ""}
                  onClick={() => setChartType("bar")}><BarChart3 size={12} />Barras</button>
              </div><div className="analytics-comparison-controls">
                <label className="analytics-compare-toggle"><input type="checkbox" checked={comparison}
                  onChange={(event) => setComparison(event.target.checked)}
                  disabled={scopedData.coverage.previousStatus !== "complete"} /><span>Comparar período</span></label>
                {canCollect && scopedData.coverage.previousStatus !== "complete" && <button type="button"
                  className="analytics-collect-comparison" onClick={() => collect("previous")} disabled={pending}>
                  <RefreshCw size={11} /> Atualizar comparação
                </button>}
              </div></div>
            </div>
            <AnalyticsTrendChart data={scopedData} metrics={mainMetrics} comparison={comparison} chartType={chartType} height={300} />
          </article>
          <article className="analytics-card analytics-account-card">
            <div className="analytics-card-heading"><div><span className="analytics-card-kicker">DISTRIBUIÇÃO</span><h3>Investimento por conta</h3></div><WalletCards size={17} /></div>
            {spendMetric && !scopeData ? <AnalyticsAccountChart data={data} metric={spendMetric} /> :
              <p className="analytics-empty-copy">A distribuição por conta usa o escopo completo. Remova o filtro de campanhas para visualizá-la.</p>}
          </article>
        </div>
        <div className="analytics-insights-grid">
          <article className="analytics-card analytics-observations">
            <div className="analytics-card-heading"><div><span className="analytics-card-kicker">LEITURA DOS DADOS</span><h3>O que merece atenção</h3></div><Sparkles size={17} /></div>
            <div className="analytics-observation-list">{observations.map((item, index) => <div className="analytics-observation" key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span><div><h4>{item.title}</h4><p>{item.text}</p></div>
            </div>)}</div>
            <p className="analytics-footnote">Observações descritivas calculadas sobre o escopo atual.</p>
          </article>
          <article className="analytics-card analytics-results-card">
            <div className="analytics-card-heading"><div><span className="analytics-card-kicker">AÇÕES DA PLATAFORMA</span><h3>Resultados em detalhe</h3></div><Target size={17} /></div>
            <div className="analytics-action-list">{actions.length ? actions.map((metric) => <div key={metric.key}>
              <span>{metric.label}{metric.key === `action:${data.primaryActionType}` && <small>Resultado principal</small>}</span>
              <strong>{formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}</strong>
            </div>) : <p className="analytics-empty-copy">Sem ações disponíveis neste período.</p>}</div>
            <p className="analytics-footnote">Tipos de ação podem se sobrepor e não são somados como uma conversão única.</p>
          </article>
        </div>
        <article className="analytics-card analytics-campaign-card">
          <div className="analytics-card-heading"><div><span className="analytics-card-kicker">DE ONDE VÊM OS RESULTADOS</span>
            <h3>Seleção incluída na análise <span className="analytics-count">{selectedEntities.length}</span></h3></div>
            <button type="button" className="analytics-text-button" onClick={() => setTab("campaigns")}>Editar seleção <ArrowUpRight size={14} /></button>
          </div>
          <div className="analytics-table-scroll"><table className="analytics-table analytics-campaign-table">
            <thead><tr><th>Campanha / conta</th>{fixedMetrics.slice(0, 4).map((metric) => <th key={metric.key}>{metric.label}</th>)}</tr></thead>
            <tbody>{selectedEntities.map((campaign, index) => <tr key={campaign.id}><th scope="row">
              <div className="analytics-campaign-name"><span className="analytics-campaign-mark"
                style={{ color: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] }}><BarChart3 size={15} /></span>
                <div><strong>{campaign.name}</strong><small>{campaign.accountName}</small></div></div>
            </th>{fixedMetrics.slice(0, 4).map((metric) => <td key={metric.key}>
              {formatAnalyticsValue(campaign.values[metric.key], metric, campaign.currency || data.currency)}
            </td>)}</tr>)}</tbody>
          </table></div>
        </article>
      </>}

      {tab === "campaigns" && <>
        <div className="analytics-campaign-scope-bar">
          <label><span>Plataforma</span><select className="input" defaultValue="meta">
            <option value="meta">Meta Ads</option>
            <option value="google" disabled>Google Ads · em breve</option>
            <option value="tiktok" disabled>TikTok Ads · em breve</option>
          </select></label>
          <div><span>Conta(s)</span><strong>{data.selectedAccountIds.length === data.accounts.length ? "Todas as contas selecionadas" : `${data.selectedAccountIds.length} conta(s)`}</strong></div>
          <div><span>Campanhas</span><strong>{draftEntityKeys.length} de {data.campaigns.length}</strong></div>
          <button type="button" className="analytics-button analytics-button-primary" onClick={applyCampaignScope} disabled={pending || !roots.length}>
            {pending ? "Aplicando…" : "Aplicar seleção"}
          </button>
        </div>
        <article className="analytics-card analytics-campaign-card">
          <div className="analytics-card-heading"><div><span className="analytics-card-kicker">META ADS · HIERARQUIA</span>
            <h3>Campanhas com movimentação no período</h3></div>
            <div className="analytics-campaign-heading-actions">
              <button type="button" className="analytics-text-button" onClick={() => setSelectedLeaves(allLeaves)}>Selecionar todas</button>
              <label className="analytics-search"><Search size={14} /><input type="search" value={campaignQuery}
                onChange={(event) => setCampaignQuery(event.target.value)} placeholder="Buscar campanha…" /></label>
            </div>
          </div>
          <div className="analytics-table-scroll"><table className="analytics-table analytics-campaign-table">
            <thead><tr><th scope="col">Selecionar · campanha / conta</th>{campaignMetrics.map((metric) => <th scope="col" key={metric.key}
              draggable onDragStart={() => setDraggedMetricKey(metric.key)}
              onDragOver={(event) => event.preventDefault()} onDrop={() => moveCampaignMetric(metric.key)}
              className={draggedMetricKey === metric.key ? "is-dragging" : ""}>
              <button type="button" onClick={() => sortBy(metric.key)} title="Arraste para mudar a posição da coluna">{metric.label}
                {sortKey === metric.key && <ChevronDown size={12} style={{ transform: sortDirection === "asc" ? "rotate(180deg)" : undefined }} />}
              </button></th>)}</tr></thead>
            <CampaignTree entities={entities} roots={visibleCampaigns} metrics={campaignMetrics}
              selected={selectedLeaves} onChange={setSelectedLeaves} disabled={pending} />
          </table></div>
          {!data.campaigns.length && <p className="analytics-empty-copy">Nenhuma campanha com movimentação foi coletada para este período.</p>}
          <p className="analytics-footnote">A seleção aplicada passa a controlar a Visão geral. Expanda as linhas para escolher conjuntos ou anúncios. Se não houver detalhamento, atualize os dados.</p>
        </article>
      </>}
      {tab === "metrics" && <div className="analytics-metric-catalog">
        {["Investimento e eficiência", "Entrega e alcance", "Cliques e tráfego", "Resultados e ações", "Vídeo", "Engajamento e outros"].map((group) => {
          const groupMetrics = data.metrics.filter((metric) => metricGroup(metric) === group);
          if (!groupMetrics.length) return null;
          return <section className="analytics-metric-group" key={group}>
            <div className="analytics-metric-group-heading"><div><span className="analytics-card-kicker">META ADS</span><h3>{group}</h3></div>
              <span className="analytics-count">{groupMetrics.length}</span></div>
            <div className="analytics-kpi-grid">{groupMetrics.map((metric, index) => {
              const checked = optionalMetricKeys.includes(metric.key);
              const color = ANALYTICS_COLORS[index % ANALYTICS_COLORS.length];
              return <article className={`analytics-kpi analytics-metric-select-card${checked ? " is-selected" : ""}`}
                key={metric.key} style={{ "--metric-color": color } as CSSProperties}>
                <div className="analytics-kpi-top"><span>{metric.label}</span><label className="analytics-metric-checkbox">
                  <input type="checkbox" checked={checked} disabled={FIXED_METRICS.includes(metric.key)}
                    onChange={() => toggleMetric(metric.key)} />
                  <span>{FIXED_METRICS.includes(metric.key) ? <Lock size={12} /> : <Check size={12} />}</span>
                </label></div>
                <strong className={`analytics-kpi-value${scopedData.summary[metric.key] == null ? " is-unavailable" : ""}`}>
                  {formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}
                </strong>
                <p className="analytics-metric-card-note">{FIXED_METRICS.includes(metric.key) ? "Indicador fixo da Visão geral" : checked ? "Exibida na Visão geral" : "Marque para adicionar à Visão geral"}</p>
              </article>;
            })}</div>
          </section>;
        })}
      </div>}
      {tab === "reports" && <div className="analytics-reports-space">
        <section className="analytics-card analytics-report-create-card">
          <div className="analytics-card-heading"><div><span className="analytics-card-kicker">RELATÓRIO DO ESCOPO ATUAL</span>
            <h3>{canManageReports ? "Gerar e preservar relatório" : "Exportar análise em PDF"}</h3></div><FileText size={17} /></div>
          <div className="analytics-report-create-body">
            <p>Período: <strong>{displayDate(data.dateFrom)} – {displayDate(data.dateTo)}</strong> · {data.selectedAccountIds.length} conta(s) · {overviewMetrics.length} métricas.</p>
            <div className="analytics-report-header-fields">
              <label>Nome no cabeçalho<input className="input" value={headerName} maxLength={160} onChange={event => setHeaderName(event.target.value)} /></label>
              <label>Informações do responsável<textarea className="input" rows={2} value={headerDetails} maxLength={500}
                placeholder="Empresa, gestor, site ou contato" onChange={event => setHeaderDetails(event.target.value)} /></label>
            </div>
            {scopeDirty && <p role="status">Aplique a seleção na aba Campanhas antes de gerar o relatório.</p>}
            <button type="button" className="analytics-button analytics-button-secondary" disabled={pending || scopeDirty} onClick={exportPdf}>
              <Download size={14} />Baixar PDF da análise atual</button>
            <div className="analytics-report-create-controls">
              <input className="input" value={reportTitle} onChange={(event) => setReportTitle(event.target.value)}
                maxLength={200} aria-label="Título do relatório" />
              {canManageReports && <button type="button" className="analytics-button analytics-button-primary" onClick={generateReport}
                disabled={pending || scopeDirty || reportTitle.trim().length < 2}><FileText size={14} />{pending ? "Gerando…" : "Gerar e salvar relatório"}</button>}
            </div>
            <small>{canManageReports
              ? "A versão gerada fica salva e pode ser publicada para o cliente."
              : "A exportação é local e não cria um relatório salvo no sistema."}</small>
          </div>
        </section>
        <section className="analytics-card analytics-report-list-card">
          <div className="analytics-card-heading"><div><span className="analytics-card-kicker">HISTÓRICO</span>
            <h3>Relatórios {canManageReports ? "deste cliente" : "publicados"}</h3></div>
            <select className="input" aria-label="Estado dos relatórios" value={reportState} onChange={event => setReportState(event.target.value)}>
              <option value="all">Todos os estados</option><option value="published">Publicados</option>
              {canManageReports && <option value="ready">Prontos para publicar</option>}<option value="superseded">Histórico</option>
            </select>
            <label className="analytics-search"><Search size={14} /><input type="search" value={reportSearch}
              onChange={(event) => setReportSearch(event.target.value)} placeholder="Buscar relatório…" /></label>
          </div>
          {reportRows.length ? <div className="analytics-report-list">{reportRows.map((report) => <div className="analytics-report-row" key={report.reportVersionId}>
            <div><strong>{report.title} · v{report.versionNumber}</strong>
              <span>{displayDate(report.dateFrom)} – {displayDate(report.dateTo)}</span></div>
            <span className={`analytics-report-state is-${report.state}`}>
              {report.state === "ready" ? "Pronto para publicar" : report.state === "published" ? "Publicado" : "Histórico"}
            </span>
            <div className="analytics-report-actions">
              <button type="button" className="analytics-button analytics-button-secondary" onClick={() => downloadReport(report.reportVersionId)} disabled={pending}><Download size={14} />PDF</button>
              {(report.state === "published" || report.state === "superseded") && <Link className="analytics-button analytics-button-secondary"
                href={`/cliente/${clientId}/relatorios/${report.reportVersionId}`}>Visualizar</Link>}
              {canManageReports && report.state === "ready" && <button type="button" className="analytics-button analytics-button-primary"
                onClick={() => publishReport(report.reportVersionId)} disabled={pending}>Publicar</button>}
              {canManageReports && <button type="button" className="analytics-icon-danger" onClick={() => deleteReport(report.reportId)}
                aria-label={`Excluir ${report.title}`} disabled={pending}><Trash2 size={15} /></button>}
            </div>
          </div>)}</div> : <p className="analytics-empty-copy">Nenhum relatório encontrado.</p>}
        </section>
      </div>}
    </div>

    <footer className="analytics-data-footer"><span><Check size={12} />Dados da plataforma · calendário local de cada conta</span>
      <span>Sem estimativas para datas não coletadas</span></footer>
  </section>;
}
