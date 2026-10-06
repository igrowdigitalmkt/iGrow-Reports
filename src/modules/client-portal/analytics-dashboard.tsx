"use client";

import { resultBreakdown, resultCostBreakdown } from "./analytics-results";
import { hasConfirmedAnalytics } from "./analytics-readiness";
import { changeDescription } from "./analytics-comparison";
import { reconcileHierarchySelection } from "./analytics-selection";
import { resultCardLayout, wrapResultLabel } from "./result-card-layout";

import Link from "next/link";
import { ANALYSIS_MODELS, modelMetrics, moveMetric } from "./analysis-models";
import { CampaignTree } from "./campaign-tree";
import { compactEntitySelection, entityDeliveryLabel, entityDeliveryRank, leafKeys, relevantCampaignHierarchy, type AnalyticsEntity } from "./analytics-hierarchy";
import { downloadDashboardPdf, downloadSavedReportPdf } from "@/modules/reports/pdf-download";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type FormEvent } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, CalendarRange, Check, ChevronDown,
  CircleDollarSign, Clock3, Download, FileText, Filter, Info, Layers3, Lock,
  MousePointerClick, RefreshCw, Search, Sparkles, Target, Trash2, TrendingUp,
  WalletCards, X, RectangleHorizontal, RectangleVertical, SlidersHorizontal, Table2, GripVertical, ArrowLeftRight,
} from "lucide-react";
import { collectDashboardData } from "./analytics-actions";
import { getCampaignScopedAnalytics, getClientAnalyticsHierarchy } from "./analytics-scope-actions";
import { deleteDashboardReport, generateDashboardReport } from "./report-actions";
import { publishReportVersion } from "@/modules/reports/actions";
import { resolveAnalyticsRange } from "./range";
import { ANALYTICS_MAX_AUTOMATIC_FAILURES, ANALYTICS_REFRESH_MS, analyticsRetryDelay } from "./analytics-freshness";
import { estimatedMetric } from "@/modules/reports/report-presentation";
import type { AnalyticsDashboardData, AnalyticsReportItem, AnalyticsValues } from "./analytics-types";
import {
  ANALYTICS_COLORS, AnalyticsAccountChart, AnalyticsSparkline, AnalyticsTrendChart,
  formatAnalyticsValue, formatEntityAnalyticsValue, type AnalyticsMetric,
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
  /** Link to the per-account, per-level confirmed analysis (agency only). */
  detailedAnalysisHref?: string;
};

const PERIODS = [
  { key: "7d", label: "7 dias" }, { key: "30d", label: "30 dias" },
  { key: "90d", label: "3 meses" }, { key: "180d", label: "6 meses" },
  { key: "365d", label: "1 ano" }, { key: "custom", label: "Personalizado" },
];
const FIXED_METRICS = ["spend", "primary_results", "cost_per_result"];
const DEFAULT_OPTIONAL_METRICS = ["reach", "impressions", "cpm", "link_clicks", "ctr_link", "cpc_link", "frequency", "clicks", "inline_post_engagement"];
const OVERVIEW_PREFERENCE_VERSION = 2;
const isPinned = (key: string) => FIXED_METRICS.includes(key);
const METRIC_ICONS = {
  spend: CircleDollarSign, impressions: TrendingUp, link_clicks: MousePointerClick,
  primary_results: Target, reach: Activity, cpm: BarChart3, cost_per_result: CircleDollarSign,
};

function displayDate(value: string, includeYear = true) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "short", ...(includeYear ? { year: "numeric" } : {}), timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}
function metricGroup(metric: AnalyticsMetric) {
  if (["spend", "cpc_link", "cpm", "cost_per_result", "attributed_revenue", "roas", "cpc", "cpp"].includes(metric.key) || metric.key.startsWith("cost:") || metric.key.startsWith("value:")) return "Investimento e eficiência";
  if (["impressions", "reach", "frequency", "unique_clicks"].includes(metric.key)) return "Entrega e alcance";
  if (["link_clicks", "ctr_link", "clicks", "outbound_clicks", "ctr", "unique_inline_link_clicks", "unique_inline_link_click_ctr", "unique_ctr", "outbound_clicks_ctr", "unique_outbound_clicks_ctr"].includes(metric.key)) return "Cliques e tráfego";
  if (metric.key.includes("video")) return "Vídeo";
  if (metric.key.startsWith("action:") || metric.key === "primary_results") return "Resultados e ações";
  return "Engajamento e outros";
}
function unavailableReason(data: AnalyticsDashboardData, metric: AnalyticsMetric) {
  if (["reach", "frequency", "unique_clicks", "unique_inline_link_clicks", "unique_inline_link_click_ctr", "unique_ctr", "unique_outbound_clicks"].includes(metric.key)
    && data.selectedAccountIds.length > 1) return "A Meta não retornou os valores necessários para estimar este indicador entre contas.";
  if (metric.unit === "currency" && !data.currency) return "As contas selecionadas usam moedas diferentes. Filtre contas da mesma moeda para ver este total. O investimento de cada conta aparece separadamente abaixo.";
  if (data.coverage.status !== "complete") return "O período ainda tem dados sem coleta. Atualize os dados para completar a análise.";
  return "A Meta não retornou este indicador para o escopo selecionado, ou não há resultados para calcular a taxa/custo.";
}

function sumAccountMetric(data: AnalyticsDashboardData, key: string) {
  let total = 0;
  const accounts = data.accountTotals.filter(account => data.selectedAccountIds.includes(account.id));
  if (!accounts.length || accounts.length !== data.selectedAccountIds.length) return null;
  for (const account of accounts) {
    const value = account.values[key];
    if (value == null || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function compareCampaignEntities(a: AnalyticsEntity, b: AnalyticsEntity, key: string, direction: "asc" | "desc") {
  const factor = direction === "desc" ? -1 : 1;
  if (key === "status") {
    const status = entityDeliveryRank(a) - entityDeliveryRank(b);
    if (status !== 0) return status * factor;
    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  }
  if (key === "name") return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) * factor;
  const av = a.values[key];
  const bv = b.values[key];
  if (av == null && bv == null) return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  if (av == null) return 1;
  if (bv == null) return -1;
  const diff = av - bv;
  return diff === 0 ? a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) : diff * factor;
}

function normalizeEssentialMetrics(data: AnalyticsDashboardData): AnalyticsDashboardData {
  const summary: AnalyticsValues = { ...data.summary };
  const estimatedMetricKeys = new Set(data.estimatedMetricKeys ?? []);
  let changed = false;

  if (data.selectedAccountIds.length > 1) {
    for (const key of ["reach", "unique_clicks", "unique_inline_link_clicks", "unique_outbound_clicks"]) {
      if (summary[key] != null) continue;
      const total = sumAccountMetric(data, key);
      if (total == null) continue;
      summary[key] = total;
      estimatedMetricKeys.add(key);
      changed = true;
    }
    if (summary.frequency == null && summary.reach && summary.impressions != null) {
      summary.frequency = summary.impressions / summary.reach;
      estimatedMetricKeys.add("frequency");
      changed = true;
    }
  }

  return changed ? { ...data, summary, estimatedMetricKeys: [...estimatedMetricKeys] } : data;
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
const retryClock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function ClientAnalyticsDashboard({
  data, entities, workspaceName, clientName, clientId, workspaceId, canCollect, canManageReports, reports, preferenceKey, detailedAnalysisHref,
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
  const [tab, setTab] = useState<"overview" | "campaigns" | "metrics" | "reports">(query.get("aba") === "reports" ? "reports" : "overview");
  const [campaignQuery, setCampaignQuery] = useState("");
  const [hierarchyEntities, setHierarchyEntities] = useState<AnalyticsEntity[]>(() => relevantCampaignHierarchy(entities));
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState("");
  const dataSnapshotKey = JSON.stringify([data.dateFrom, data.dateTo, data.selectedAccountIds,
    data.coverage.latestCollectedAt, data.metaAggregate?.collectedAt, data.metaAggregate?.version]);
  const [hierarchySnapshotKey, setHierarchySnapshotKey] = useState(dataSnapshotKey);
  const roots = hierarchyEntities.filter(entity => entity.level === "campaign");
  const allLeaves = roots.flatMap(entity => leafKeys(entity, hierarchyEntities));
  const [selectedLeaves, setSelectedLeaves] = useState(allLeaves);
  const [appliedEntityKeys, setAppliedEntityKeys] = useState(roots.map(entity => entity.key));
  const draftEntityKeys = compactEntitySelection(hierarchyEntities, selectedLeaves);
  const scopeDirty = [...draftEntityKeys].sort().join(",") !== [...appliedEntityKeys].sort().join(",");
  const [scopeData, setScopeData] = useState<Pick<AnalyticsDashboardData, "summary" | "previousSummary" | "daily" | "previousDaily" | "coverage" | "estimatedMetricKeys" | "metrics" | "metaAggregate"> | null>(null);
  const [scopeSnapshotKey, setScopeSnapshotKey] = useState<string | null>(null);
  const selectionRef = useRef({ entities: hierarchyEntities, selectedLeaves, appliedEntityKeys, unrestricted: scopeData === null });
  useEffect(() => {
    selectionRef.current = { entities: hierarchyEntities, selectedLeaves, appliedEntityKeys, unrestricted: scopeData === null };
  }, [hierarchyEntities, selectedLeaves, appliedEntityKeys, scopeData]);
  const [sortKey, setSortKey] = useState("status");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [comparison, setComparison] = useState(true);
  const [chartType, setChartType] = useState<"line" | "bar">("line");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [collectingComparison, setCollectingComparison] = useState(false);
  const [headerName, setHeaderName] = useState(workspaceName);
  const [headerDetails, setHeaderDetails] = useState("");
  const [analysisNote, setAnalysisNote] = useState("");
  const [presenting, setPresenting] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    const changed = () => setPresenting(document.fullscreenElement === dashboardRef.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const [reportTitle, setReportTitle] = useState("Relatório de performance");
  const [reportSearch, setReportSearch] = useState("");
  const [metricSearch, setMetricSearch] = useState("");
  const [reportState, setReportState] = useState("all");
  const [pending, startTransition] = useTransition();
  const [navigating, startNavigation] = useTransition();
  const [applyingPeriodLabel, setApplyingPeriodLabel] = useState("");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const dashboardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const menus = () => dashboardRef.current?.querySelectorAll<HTMLDetailsElement>("details.analytics-filter-menu, details.analytics-quality-menu") ?? [];
    const outside = (event: PointerEvent) => {
      for (const menu of menus()) if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const menu of menus()) if (menu.open) { menu.open = false; menu.querySelector("summary")?.focus(); }
    };
    const root = dashboardRef.current;
    const opened = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement) || !target.open || !target.matches(".analytics-filter-menu, .analytics-quality-menu")) return;
      for (const menu of menus()) if (menu !== target) menu.open = false;
    };
    root?.addEventListener("toggle", opened, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); root?.removeEventListener("toggle", opened, true); };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(`igrow:analytics:${preferenceKey}`);
        if (saved) {
          const parsed = JSON.parse(saved) as { overview?: string[]; campaign?: string[]; analysisNote?: string; overviewLayoutVersion?: number };
          if (canManageReports && typeof parsed.analysisNote === "string") setAnalysisNote(parsed.analysisNote.slice(0, 5000));
          const available = new Set(data.metrics.map((metric) => metric.key));
          if (Array.isArray(parsed.overview)) {
            const migratedDefaults = parsed.overviewLayoutVersion === OVERVIEW_PREFERENCE_VERSION
              ? []
              : ["reach", "impressions", "cpm"];
            setOptionalMetricKeys([...new Set([
              ...migratedDefaults,
              ...parsed.overview.filter((key) => available.has(key) && !FIXED_METRICS.includes(key)),
            ])].filter(key => available.has(key)));
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
  }, [data.metrics, preferenceKey, canManageReports]);

  useEffect(() => {
    if (!preferencesLoaded) return;
    try { window.localStorage.setItem(`igrow:analytics:${preferenceKey}`, JSON.stringify({
      overview: optionalMetricKeys,
      overviewLayoutVersion: OVERVIEW_PREFERENCE_VERSION,
      campaign: campaignMetricKeys,
      analysisNote: canManageReports ? analysisNote : undefined,
    })); } catch { /* Armazenamento local bloqueado não impede a análise. */ }
  }, [analysisNote, canManageReports, campaignMetricKeys, optionalMetricKeys, preferenceKey, preferencesLoaded]);

  const baseAnalyticsReady = hasConfirmedAnalytics(data);
  // Failures survive re-renders of the same period so retries keep backing off.
  const retryFailures = useRef({ key: "", count: 0 });
  const [retryRun, setRetryRun] = useState(0);
  const [autoRetry, setAutoRetry] = useState<{ phase: "idle" | "running" | "waiting" | "paused"; lastAt: number | null; nextAt: number | null }>({ phase: "idle", lastAt: null, nextAt: null });
  useEffect(() => {
    const periodKey = `${clientId}|${data.dateFrom}|${data.dateTo}`;
    if (retryFailures.current.key !== periodKey) retryFailures.current = { key: periodKey, count: 0 };
    let cancelled = false;
    let updating = false;
    let timer: number | undefined;
    const updated = Math.max(Date.parse(data.coverage.latestCollectedAt ?? "") || 0, Date.parse(data.metaAggregate?.collectedAt ?? "") || 0);
    const incomplete = !baseAnalyticsReady;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (incomplete && retryFailures.current.count >= ANALYTICS_MAX_AUTOMATIC_FAILURES) {
        setAutoRetry(current => ({ ...current, phase: "paused", nextAt: null }));
        return;
      }
      setAutoRetry(current => ({ ...current, phase: "waiting", nextAt: Date.now() + delay }));
      timer = window.setTimeout(() => { void refresh(); }, delay);
    };
    const refresh = async () => {
      if (cancelled || updating) return;
      if (document.visibilityState !== "visible") return; // resumes on visibilitychange
      updating = true;
      setAutoRetry(current => ({ ...current, phase: "running", nextAt: null }));
      let failed = false;
      try {
        const result = await collectDashboardData({ clientId, from: data.dateFrom, to: data.dateTo, automatic: true });
        if (result.error) { failed = true; setError(result.error); }
      } catch {
        failed = true;
        setError("Não foi possível consultar os dados agora. Uma nova tentativa será feita automaticamente.");
      } finally { updating = false; }
      if (cancelled) return;
      retryFailures.current.count = failed ? retryFailures.current.count + 1 : 0;
      setAutoRetry(current => ({ ...current, lastAt: Date.now() }));
      // Re-render only when something may have changed; a failed attempt left the data as it was.
      if (!failed) { setError(""); router.refresh(); }
      schedule(incomplete || failed ? analyticsRetryDelay(Math.max(1, retryFailures.current.count)) : ANALYTICS_REFRESH_MS);
    };
    const first = incomplete
      ? retryFailures.current.count ? analyticsRetryDelay(retryFailures.current.count) : 5_000
      : Number.isFinite(updated) ? Math.max(1000, ANALYTICS_REFRESH_MS - (Date.now() - updated)) : ANALYTICS_REFRESH_MS;
    const start = window.setTimeout(() => schedule(first), 0);
    const resumed = () => {
      if (document.visibilityState !== "visible" || updating) return;
      if (incomplete ? retryFailures.current.count < ANALYTICS_MAX_AUTOMATIC_FAILURES : Date.now() - updated >= ANALYTICS_REFRESH_MS) void refresh();
    };
    document.addEventListener("visibilitychange", resumed);
    return () => { cancelled = true; window.clearTimeout(start); window.clearTimeout(timer); document.removeEventListener("visibilitychange", resumed); };
  }, [clientId, data.dateFrom, data.dateTo, data.coverage.latestCollectedAt, data.metaAggregate?.collectedAt, baseAnalyticsReady, router, retryRun]);
  function retryAutomaticNow() {
    retryFailures.current.count = 0;
    setRetryRun(value => value + 1);
  }

  const selectedEntities = hierarchyEntities.filter(entity => appliedEntityKeys.includes(entity.key));
  const scopeCurrent = scopeData === null || scopeSnapshotKey === dataSnapshotKey;
  const activeScopeData = data.coverage.status === "complete" && scopeCurrent ? scopeData : null;
  const scopedData = normalizeEssentialMetrics(scopeData && !scopeCurrent
    ? { ...data, summary: {}, previousSummary: {}, daily: [], previousDaily: [], campaigns: [],
      coverage: { ...data.coverage, status: "partial", previousStatus: "partial" } }
    : { ...data, ...(activeScopeData ?? {}), campaigns: scopeData ? selectedEntities.map(entity => ({
      id: entity.id, name: entity.name, accountId: entity.accountId, accountName: entity.accountName,
      currency: entity.currency, status: null, values: entity.values,
    })) : data.campaigns });
  // While a new period loads, the confirmed numbers stay visible (dimmed) instead of disappearing.
  const analyticsReady = hasConfirmedAnalytics(data) && hasConfirmedAnalytics(scopedData);
  const resultRows = resultBreakdown(scopedData.summary);
  const resultCostRows = resultCostBreakdown(scopedData.summary, scopeData
    ? hierarchySnapshotKey === dataSnapshotKey && scopeCurrent ? selectedEntities : []
    : data.campaigns);
  const resultCostByKey = new Map(resultCostRows.map(result => [result.key, result.cost]));
  const resultLayout = resultCardLayout(resultRows.length);
  const fixedMetrics = FIXED_METRICS.map((key) => scopedData.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is AnalyticsMetric => !!metric);
  const optionalMetrics = optionalMetricKeys.flatMap(key => {
    const metric = scopedData.metrics.find(item => item.key === key);
    return metric && !FIXED_METRICS.includes(key) ? [metric] : [];
  });
  const overviewMetrics = [...fixedMetrics, ...optionalMetrics];
  const campaignMetrics = campaignMetricKeys
    .map((key) => scopedData.metrics.find((metric) => metric.key === key))
    .filter((metric): metric is AnalyticsMetric => !!metric);
  const mainMetrics = [
    scopedData.metrics.find((metric) => metric.key === "spend"),
    scopedData.metrics.find((metric) => metric.key === "primary_results"),
  ].filter((metric): metric is AnalyticsMetric => !!metric);
  const spendMetric = scopedData.metrics.find((metric) => metric.key === "spend");
  const actions = scopedData.metrics.filter((metric) => metric.key.startsWith("action:"));
  const latestTimestamp = [scopedData.coverage.latestCollectedAt, scopedData.metaAggregate?.collectedAt].filter((value): value is string => !!value)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const latest = latestTimestamp
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        timeZone: data.timezoneName ?? "America/Sao_Paulo",
      }).format(new Date(latestTimestamp))
    : "Ainda não atualizado";
  const visibleCampaigns = roots.filter(entity => {
    const descendants = hierarchyEntities.filter(item => item.campaignId === entity.id || item.key === entity.key);
    return [entity, ...descendants].some(item => item.name.toLocaleLowerCase("pt-BR").includes(campaignQuery.toLocaleLowerCase("pt-BR")));
  }).sort((a, b) => compareCampaignEntities(a, b, sortKey, sortDirection));

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
    const selectedLabel = PERIODS.find((item) => item.key === nextPeriod)?.label ?? "período selecionado";
    setApplyingPeriodLabel(nextPeriod === "custom"
      ? `${displayDate(customFrom)} a ${displayDate(customTo)}`
      : selectedLabel);
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
      const result = await collectDashboardData({ clientId, from: collectFrom, to: collectTo, includeComparison: range === "current" });
      if (result.error) {
        setError(result.error ?? "Não foi possível concluir esta ação.");
        router.refresh();
        return;
      }
      setNotice(range === "previous"
        ? "Período anterior atualizado."
        : "Dados atualizados para o período selecionado.");
      router.refresh();
    });
  }

  // Drag a card onto another to take its position; the order is saved like the other preferences.
  function dropCard(target: string) {
    const source = draggingCard;
    setDraggingCard(null); setDropTarget(null);
    if (!source || source === target) return;
    setOptionalMetricKeys(keys => {
      const next = keys.filter(key => key !== source);
      next.splice(next.indexOf(target) + (keys.indexOf(source) < keys.indexOf(target) ? 1 : 0), 0, source);
      return next;
    });
  }
  function replaceMetric(current: string, replacement: string) {
    if (!replacement) return;
    setOptionalMetricKeys(keys => keys.includes(replacement) ? keys : keys.map(key => key === current ? replacement : key));
  }
  function toggleMetric(key: string) {
    if (isPinned(key)) return;
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
    if (navigating || data.coverage.status !== "complete" || hierarchyLoading) { setError("A seleção só pode ser aplicada quando a coleta do período estiver completa."); return; }
    if (!draftEntityKeys.length) { setError("Selecione ao menos uma campanha, conjunto ou anúncio."); return; }
    const nextKeys = [...draftEntityKeys];
    if (selectedLeaves.length === allLeaves.length) {
      setScopeData(null); setScopeSnapshotKey(null); setAppliedEntityKeys(nextKeys); setTab("overview"); return;
    }
    startTransition(async () => {
      const result = await getCampaignScopedAnalytics({ clientId, dateFrom: data.dateFrom, dateTo: data.dateTo,
        accountIds: data.selectedAccountIds, entityKeys: nextKeys });
      if ("error" in result) { setError(result.error ?? "Não foi possível aplicar a seleção."); return; }
      setScopeData(result);
      setScopeSnapshotKey(dataSnapshotKey);
      setAppliedEntityKeys(nextKeys); setTab("overview");
    });
  }

  function exportPdf(orientation: "vertical" | "horizontal" = "vertical") {
    setError(""); setNotice("");
    if (!analyticsReady) {
      setError("O relatório só pode ser gerado quando todos os dias do período estiverem confirmados.");
      return;
    }
    startTransition(async () => {
      try {
        if (canManageReports) {
          const result = await generateDashboardReport({ clientId, dateFrom: data.dateFrom, dateTo: data.dateTo,
            accountIds: data.selectedAccountIds, metricKeys: overviewMetrics.map(metric => metric.key),
            entityKeys: scopeData ? appliedEntityKeys : [], campaignMetricKeys, comparison, chartType, orientation,
            header: { name: headerName, details: headerDetails, analysisNote }, title: reportTitle });
          if ("error" in result) { setError(result.error ?? "Não foi possível concluir esta ação."); return; }
          router.refresh();
          try { await downloadSavedReportPdf(clientId, result.reportVersionId); }
          catch { setError("O relatório foi salvo. Baixe o PDF pela seção Relatórios."); return; }
          setNotice("Relatório salvo e baixado. Ele está em Relatórios, pronto para revisar e publicar para o cliente.");
        } else {
          await downloadDashboardPdf({ title: reportTitle, clientName, workspaceName: headerName || workspaceName,
            headerDetails, analysisNote, data: scopedData, metrics: overviewMetrics,
            entityLabels: scopeData ? selectedEntities.map(entity => entity.name) : ["Todas as campanhas"],
            accountLabels: data.accounts.filter(account => data.selectedAccountIds.includes(account.id)).map(account => account.name),
            comparison, chartType, entityRows: scopeData ? selectedEntities : entities, campaignMetrics, orientation });
        }
      } catch { setError("Não foi possível gerar o relatório. Tente novamente."); }
    });
  }

  function downloadReport(reportVersionId: string) {
    startTransition(async () => {
      try { await downloadSavedReportPdf(clientId, reportVersionId); }
      catch { setError("Não foi possível baixar este relatório."); }
    });
  }

  function sortBy(key: string) {
    setSortDirection(sortKey === key && sortDirection === "desc" ? "asc" : key === "name" ? "asc" : "desc");
    setSortKey(key);
  }

  function selectTab(nextTab: typeof tab) {
    setTab(nextTab);
  }

  useEffect(() => {
    if (data.coverage.status !== "complete" || !data.selectedAccountIds.length) return;
    let cancelled = false;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState !== "visible") return;
      loading = true;
      setHierarchyLoading(true);
      setHierarchyError("");
      setHierarchyEntities(current => current.map(entity => ({ ...entity, effectiveStatus: null })));
      try {
        const result = await getClientAnalyticsHierarchy({ clientId, dateFrom: data.dateFrom, dateTo: data.dateTo, accountIds: data.selectedAccountIds });
        if (cancelled) return;
        if ("error" in result) {
          setHierarchyError(result.error ?? "Não foi possível carregar conjuntos e anúncios.");
          return;
        }
        const current = selectionRef.current;
        const selectionRequestKey = JSON.stringify([current.unrestricted, current.appliedEntityKeys]);
        const selection = reconcileHierarchySelection({ previous: current.entities, next: result.entities,
          selectedLeaves: current.selectedLeaves, appliedEntityKeys: current.appliedEntityKeys, unrestricted: current.unrestricted });
        if (!current.unrestricted) {
          if (!selection.appliedEntityKeys.length) {
            setScopeSnapshotKey(null);
            setError("A seleção anterior não tem dados confirmados neste período. Escolha campanhas novamente.");
            return;
          }
          const refreshed = await getCampaignScopedAnalytics({ clientId, dateFrom: data.dateFrom, dateTo: data.dateTo,
            accountIds: data.selectedAccountIds, entityKeys: selection.appliedEntityKeys });
          if (cancelled) return;
          if ("error" in refreshed) {
            setScopeSnapshotKey(null);
            setError(refreshed.error ?? "Não foi possível confirmar a seleção atualizada.");
            return;
          }
          if (selectionRequestKey !== JSON.stringify([selectionRef.current.unrestricted, selectionRef.current.appliedEntityKeys])) return;
          setScopeData(refreshed);
          setScopeSnapshotKey(dataSnapshotKey);
        }
        const latest = selectionRef.current;
        if (selectionRequestKey !== JSON.stringify([latest.unrestricted, latest.appliedEntityKeys])) return;
        const latestSelection = reconcileHierarchySelection({ previous: latest.entities, next: result.entities,
          selectedLeaves: latest.selectedLeaves, appliedEntityKeys: latest.appliedEntityKeys, unrestricted: latest.unrestricted });
        setHierarchyEntities(result.entities);
        setHierarchySnapshotKey(dataSnapshotKey);
        setSelectedLeaves(latestSelection.selectedLeaves);
        setAppliedEntityKeys(latestSelection.appliedEntityKeys);
      } catch {
        if (!cancelled) setHierarchyError("Não foi possível confirmar a veiculação atual na Meta.");
      } finally {
        loading = false;
        if (!cancelled) setHierarchyLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const resumed = () => { void refresh(); };
    document.addEventListener("visibilitychange", resumed);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", resumed); };
  }, [clientId, data.dateFrom, data.dateTo, data.selectedAccountIds, data.coverage.latestCollectedAt, data.coverage.status, dataSnapshotKey]);

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

  return <section ref={dashboardRef} className={`analytics-dashboard${navigating ? " is-navigating" : ""}`} aria-label="Painel de desempenho" aria-busy={pending || navigating}>
    <header className="analytics-header">
      <div className="analytics-identity">
        <span className="client-avatar large blue" aria-hidden="true">{clientName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
        <div><h1>{clientName}</h1><p>Meta Ads · {data.accounts.length} {data.accounts.length === 1 ? "conta de anúncio" : "contas de anúncio"}</p></div>
      </div>
      <div className="analytics-command-actions">
        {detailedAnalysisHref && <Link className="analytics-button" href={detailedAnalysisHref}><Table2 size={15} />Análise por conta</Link>}
        {tab === "overview" && analyticsReady && <button type="button" className="analytics-button" onClick={async () => {
          try {
            if (document.fullscreenElement === dashboardRef.current) await document.exitFullscreen();
            else await dashboardRef.current?.requestFullscreen();
          } catch { setNotice("Este navegador não permitiu a tela cheia. Você pode usar o relatório horizontal para apresentar."); }
        }}>{presenting ? <X size={15} /> : <RectangleHorizontal size={15} />}{presenting ? "Encerrar" : "Apresentar"}</button>}
        {tab === "overview" && analyticsReady && <details className="analytics-filter-menu analytics-pdf-menu">
          <summary><Download size={15} />Exportar PDF<ChevronDown size={14} /></summary>
          <div className="analytics-filter-popover">
            <button type="button" disabled={pending || scopeDirty || !analyticsReady} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void exportPdf("vertical"); }}><RectangleVertical size={18} /><span>Vertical<small>A4 · documento</small></span></button>
            <button type="button" disabled={pending || scopeDirty || !analyticsReady} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); void exportPdf("horizontal"); }}><RectangleHorizontal size={18} /><span>Horizontal<small>1920 × 1080 · apresentação</small></span></button>
          </div>
        </details>}
        {canCollect && tab !== "reports" && <button type="button" className="analytics-button analytics-button-primary"
          onClick={() => collect()} disabled={pending || !data.accounts.length}>
          <RefreshCw size={15} className={pending ? "analytics-spin" : ""} />
          {pending ? "Atualizando…" : "Atualizar dados"}
        </button>}
      </div>
    </header>

    {tab !== "reports" && <>
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
        {navigating && <span className="analytics-updating" role="status" aria-live="polite"><RefreshCw size={13} className="analytics-spin" />Carregando {applyingPeriodLabel || "o período"}</span>}
      </div>
    </form>
    <div className="analytics-context-strip">
      <span><CalendarRange size={14} /><strong>{displayDate(data.dateFrom)} – {displayDate(data.dateTo)}</strong></span>
      <span title={[...selectedTimezones].join(" · ")}><Clock3 size={13} />{timezoneLabel}</span>
      <span>{data.currency ?? "Moeda não consolidada"}</span>
      {!!data.warnings.length && <details className="analytics-quality-menu">
        <summary><Info size={13} />Qualidade dos dados <span className="analytics-count">{data.warnings.length}</span></summary>
        <div>{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
      </details>}
      <span className="analytics-last-update"><span className="analytics-status-dot" />Atualizado em {latest}</span>
    </div>

    </>}
    {error && <div className="analytics-notice analytics-notice-error" role="alert"><Info size={17} /><p>{error}</p></div>}
    {notice && <div className="analytics-notice analytics-notice-success" role="status"><Check size={17} /><p>{notice}</p></div>}
    {pending && <div className="analytics-notice" role="status" aria-live="polite">
      <RefreshCw size={17} className="analytics-spin" /><p>{collectingComparison
        ? "Atualizando o período anterior para comparação."
        : analyticsReady
          ? "Atualizando os dados do período. Os números atuais continuam visíveis até a coleta terminar."
          : "Atualizando os dados do período. Os resultados aparecem quando a coleta terminar."}</p>
    </div>}
    {tab !== "reports" && !analyticsReady && <div className="analytics-coverage-banner analytics-coverage-blocker" role="status">
      <div><span className="analytics-coverage-icon"><Layers3 size={17} /></span><p>
        <strong>{navigating ? "Aguardando o período selecionado" : "Aguardando a análise completa"}</strong>
        <span>{navigating
          ? "Nenhum resultado será exibido até a navegação e a coleta terminarem."
          : scopedData.coverage.status === "complete"
            ? "Os dias já foram coletados. Estamos aguardando a confirmação dos totais deste período. A análise será exibida por inteiro quando estiver pronta."
            : `A coleta confirmou ${scopedData.coverage.coveredDays} de ${scopedData.coverage.totalDays} dias. O dashboard permanece bloqueado até confirmar 100% do período.`}</span>
        {!navigating && autoRetry.phase !== "idle" && <span className="analytics-retry-status" aria-live="polite">
          {autoRetry.phase === "running" && <><RefreshCw size={13} className="analytics-spin" /> Consultando agora…</>}
          {autoRetry.phase === "waiting" && autoRetry.nextAt && <>Próxima tentativa automática às {retryClock.format(autoRetry.nextAt)}{autoRetry.lastAt ? ` · última às ${retryClock.format(autoRetry.lastAt)}` : ""}.</>}
          {autoRetry.phase === "paused" && <>Tentativas automáticas pausadas após {ANALYTICS_MAX_AUTOMATIC_FAILURES} falhas seguidas{autoRetry.lastAt ? ` (última às ${retryClock.format(autoRetry.lastAt)})` : ""}.</>}
        </span>}
      </p></div>
      {!navigating && autoRetry.phase === "paused" && !canCollect && <button className="analytics-text-button" type="button" onClick={retryAutomaticNow}>
        Tentar novamente <ArrowUpRight size={14} />
      </button>}
      {canCollect && !navigating && <button className="analytics-text-button" type="button" onClick={() => { retryFailures.current.count = 0; collect(); }} disabled={pending || autoRetry.phase === "running"}>
        {pending ? "Atualizando…" : "Tentar atualizar novamente"} <ArrowUpRight size={14} />
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
          onClick={() => selectTab(key as typeof tab)}><Icon size={14} />{label}</button>)}
      </div>
      {tab === "overview" && analyticsReady && <div className="analytics-toolbar-actions"><button type="button" className="analytics-button analytics-button-ghost" onClick={() => setCustomizing(true)}><SlidersHorizontal size={15} />Personalizar relatório</button><details className="analytics-filter-menu analytics-metric-menu">
        <summary><Filter size={14} />Métricas <span className="analytics-count">{overviewMetrics.length}</span><ChevronDown size={13} /></summary>
        <div className="analytics-filter-popover">
          <div className="analytics-metric-picker-heading"><strong>Métricas da Visão geral</strong>
            <button type="button" onClick={() => setOptionalMetricKeys(DEFAULT_OPTIONAL_METRICS.filter((key) => scopedData.metrics.some((metric) => metric.key === key)))}>Padrão</button>
          </div>
          {scopedData.metrics.map((metric) => <div className="analytics-metric-picker-row" key={metric.key}>
            <label><input type="checkbox" checked={FIXED_METRICS.includes(metric.key) || optionalMetricKeys.includes(metric.key)}
              disabled={isPinned(metric.key)} onChange={() => toggleMetric(metric.key)} />
              <span>{metric.label}{FIXED_METRICS.includes(metric.key) && <small>Fixa</small>}</span></label>
          </div>)}
        </div>
      </details></div>}
      {tab === "campaigns" && analyticsReady && <details className="analytics-filter-menu analytics-metric-menu">
        <summary><Filter size={14} />Colunas <span className="analytics-count">{campaignMetrics.length}</span><ChevronDown size={13} /></summary>
        <div className="analytics-filter-popover">
          <div className="analytics-metric-picker-heading"><strong>Métricas da tabela</strong>
            <span className="muted text-xs">Arraste os cabeçalhos para reordenar</span>
          </div>
          {scopedData.metrics.map((metric) => <div className="analytics-metric-picker-row" key={metric.key}>
            <label><input type="checkbox" checked={campaignMetricKeys.includes(metric.key)}
              onChange={() => toggleCampaignMetric(metric.key)} /><span>{metric.label}</span></label>
          </div>)}
        </div>
      </details>}
    </div>
    <div role="tabpanel" id={`analytics-panel-${tab}`} aria-labelledby={`analytics-tab-${tab}`}>
      {tab === "overview" && analyticsReady && <>
        <div className="analytics-kpi-grid analytics-kpi-grid-fixed">
          {fixedMetrics.map((metric) => {
            const change = changeDescription(scopedData, metric);
            const color = ANALYTICS_COLORS[0];
            const resultMetric = metric.key === "primary_results" || metric.key === "cost_per_result";
            const showResultRows = resultMetric && resultRows.length > 0;
            // The three fixed cards share one 12-column row: result cards widen with their breakdown.
            const resultSpan = resultRows.length ? Math.max(4, resultLayout.cardSpan) : 4;
            const cardStyle = {
              "--metric-color": color,
              "--kpi-span": resultMetric ? resultSpan : Math.max(2, 12 - resultSpan * 2),
              ...(showResultRows ? {
                "--result-rows": resultLayout.rows,
                "--result-columns": resultLayout.columns,
                "--result-card-span": resultSpan,
                "--result-value-size": `${resultLayout.valueSize}px`,
                "--result-label-size": `${resultLayout.labelSize}px`,
              } : {}),
            } as CSSProperties;
            return <article className={`analytics-kpi is-fixed${showResultRows ? " has-result-rows is-result-adaptive" : ""}`} key={metric.key}
              style={cardStyle}>
              <div className="analytics-kpi-top"><span>{metric.label}</span></div>
              {showResultRows ? <div className="analytics-result-metric-list">
                {resultRows.map(result => <div className="analytics-result-metric-row" key={result.key}>
                  <strong className="analytics-result-metric-value">{metric.key === "primary_results"
                    ? result.value.toLocaleString("pt-BR")
                    : formatAnalyticsValue(resultCostByKey.get(result.key) ?? null, metric, data.currency)}</strong>
                  <span className="analytics-result-metric-label">
                    {wrapResultLabel(result.label.toLocaleLowerCase("pt-BR"), 18, 2).map((line, index) =>
                      <span className="analytics-result-metric-label-line" key={index}>{line}</span>)}
                  </span>
                </div>)}
              </div> : <strong title={scopedData.summary[metric.key] == null ? unavailableReason(scopedData, metric) : undefined} className={`analytics-kpi-value${scopedData.summary[metric.key] == null ? " is-unavailable" : ""}`}>
                {formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}
              </strong>}
              {scopedData.summary[metric.key] == null && !showResultRows && <p className="analytics-result-description">{unavailableReason(scopedData, metric)}</p>}
              {estimatedMetric(scopedData, metric.key) && <small className="analytics-estimate" title="Estimativa pela soma dos alcances ou cliques únicos das contas. Pessoas presentes em mais de uma conta podem ser contadas novamente. Frequência = impressões ÷ alcance estimado.">Estimado entre contas</small>}
              <div className={`analytics-kpi-change is-${change.direction}`}>
                {"up" in change ? change.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} /> : <span className="analytics-change-dash">—</span>}
                <span>{change.text}</span>
              </div>
              <AnalyticsSparkline values={scopedData.daily.map((day) => day.values[metric.key])} color={color} />
            </article>;
          })}
          {optionalMetrics.map((metric) => {
            const change = changeDescription(scopedData, metric);
            const Icon = METRIC_ICONS[metric.key as keyof typeof METRIC_ICONS] ?? BarChart3;
            const color = ANALYTICS_COLORS[0];
            const replacements = scopedData.metrics.filter(item => !FIXED_METRICS.includes(item.key) && !optionalMetricKeys.includes(item.key));
            return <article className={`analytics-kpi is-removable${draggingCard === metric.key ? " is-dragging" : ""}${dropTarget === metric.key && draggingCard !== metric.key ? " is-drop-target" : ""}`} key={metric.key}
              style={{ "--metric-color": color } as CSSProperties} draggable
              onDragStart={event => { setDraggingCard(metric.key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", metric.key); }}
              onDragEnter={() => draggingCard && setDropTarget(metric.key)}
              onDragOver={event => { if (draggingCard) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDrop={event => { event.preventDefault(); dropCard(metric.key); }}
              onDragEnd={() => { setDraggingCard(null); setDropTarget(null); }}>
              <div className="analytics-kpi-top"><span><GripVertical size={14} className="analytics-kpi-grip" aria-hidden="true" />{metric.label}</span>
                <div className="analytics-kpi-tools">
                  {replacements.length > 0 && <label className="analytics-kpi-swap" title="Trocar métrica"><ArrowLeftRight size={13} />
                    <select aria-label={`Trocar ${metric.label} por outra métrica`} value="" onChange={event => replaceMetric(metric.key, event.target.value)}>
                      <option value="">Trocar por…</option>
                      {replacements.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
                    </select></label>}
                  {!isPinned(metric.key) && <button className="analytics-kpi-remove" type="button" onClick={() => toggleMetric(metric.key)}
                    aria-label={`Remover ${metric.label} da visão geral`}><X size={14} /></button>}
                </div>
                <span className="analytics-kpi-icon"><Icon size={16} /></span>
              </div>
              <strong title={scopedData.summary[metric.key] == null ? unavailableReason(scopedData, metric) : undefined} className={`analytics-kpi-value${scopedData.summary[metric.key] == null ? " is-unavailable" : ""}`}>
                {formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}
              </strong>
              {estimatedMetric(scopedData, metric.key) && <small className="analytics-estimate" title="Estimativa matemática entre contas; pode incluir pessoas repetidas.">Estimado entre contas</small>}
              {scopedData.summary[metric.key] == null && <p className="analytics-result-description">{unavailableReason(scopedData, metric)}</p>}
              <div className={`analytics-kpi-change is-${change.direction}`}>
                {"up" in change ? change.up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} /> : <span className="analytics-change-dash">—</span>}
                <span>{change.text}</span>
              </div>
              <AnalyticsSparkline values={scopedData.daily.map((day) => day.values[metric.key])} color={color} />
            </article>;
          })}
        </div>
        <div className="analytics-primary-grid">
          <article className="analytics-card analytics-evolution-card">
            <div className="analytics-card-heading"><div><h3>{scopeData ? "Desempenho das campanhas selecionadas" : "Desempenho do período"}</h3></div>
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
            <div className="analytics-card-heading"><div><h3>Investimento por conta</h3></div><WalletCards size={17} /></div>
            {spendMetric && !scopeData ? <AnalyticsAccountChart data={data} metric={spendMetric} /> :
              <p className="analytics-empty-copy">A distribuição por conta usa o escopo completo. Remova o filtro de campanhas para visualizá-la.</p>}
          </article>
        </div>
        <div className="analytics-insights-grid">
          <article className="analytics-card analytics-observations">
            <div className="analytics-card-heading"><div><h3>O que merece atenção</h3></div><Sparkles size={17} /></div>
            <div className="analytics-observation-list">{observations.map((item, index) => <div className="analytics-observation" key={item.title}>
              <span>{String(index + 1).padStart(2, "0")}</span><div><h4>{item.title}</h4><p>{item.text}</p></div>
            </div>)}</div>
            <p className="analytics-footnote">Observações descritivas calculadas sobre o escopo atual.</p>
          </article>
          <article className="analytics-card analytics-results-card">
            <div className="analytics-card-heading"><div><h3>Resultados em detalhe</h3></div><Target size={17} /></div>
            <div className="analytics-action-list">{actions.length ? actions.map((metric) => <div key={metric.key}>
              <span>{metric.label}</span>
              <strong>{formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}</strong>
            </div>) : <p className="analytics-empty-copy">Sem ações disponíveis neste período.</p>}</div>
            <p className="analytics-footnote">Tipos de ação podem se sobrepor e não são somados como uma conversão única.</p>
          </article>
        </div>
        <article className="analytics-card analytics-campaign-card">
          <div className="analytics-card-heading"><div><h3>Seleção incluída na análise <span className="analytics-count">{selectedEntities.length}</span></h3></div>
            <button type="button" className="analytics-text-button" onClick={() => selectTab("campaigns")}>Editar seleção <ArrowUpRight size={14} /></button>
          </div>
          <div className="analytics-table-scroll"><table className="analytics-table analytics-campaign-table">
            <thead><tr><th>Campanha / conta</th>{fixedMetrics.slice(0, 4).map((metric) => <th key={metric.key}>{metric.label}</th>)}</tr></thead>
            <tbody>{selectedEntities.map((campaign, index) => <tr key={campaign.id}><th scope="row">
              <div className="analytics-campaign-name"><span className="analytics-campaign-mark"
                style={{ color: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] }}><BarChart3 size={15} /></span>
                <div><strong>{campaign.name}</strong><small>{campaign.accountName}</small></div></div>
            </th>{fixedMetrics.slice(0, 4).map((metric) => <td key={metric.key}>
              {formatEntityAnalyticsValue(campaign.values, metric, campaign.currency || data.currency)}
            </td>)}</tr>)}</tbody>
          </table></div>
        </article>
      </>}

      {tab === "campaigns" && analyticsReady && <>
        <div className="analytics-campaign-scope-bar">
          <label><span>Plataforma</span><select className="input" defaultValue="meta">
            <option value="meta">Meta Ads</option>
            <option value="google" disabled>Google Ads · em breve</option>
            <option value="tiktok" disabled>TikTok Ads · em breve</option>
          </select></label>
          <div><span>Conta(s)</span><strong>{data.selectedAccountIds.length === data.accounts.length ? "Todas as contas selecionadas" : `${data.selectedAccountIds.length} conta(s)`}</strong></div>
          <div><span>Campanhas</span><strong>{draftEntityKeys.length} de {roots.length}</strong></div>
          <button type="button" className="analytics-button analytics-button-primary" onClick={applyCampaignScope} disabled={pending || hierarchyLoading || !roots.length}>
            {pending ? "Aplicando…" : "Aplicar seleção"}
          </button>
        </div>
        {/* Ad sets and ads load in the background; announce only to assistive technology. */}
        <p className="sr-only" role="status">{hierarchyLoading ? "Carregando conjuntos e anúncios deste período." : ""}</p>
        {hierarchyError && <div className="analytics-notice analytics-notice-error" role="alert"><Info size={17} /><p>{hierarchyError}</p></div>}
        <article className="analytics-card analytics-campaign-card">
          <div className="analytics-card-heading"><div><h3>Campanhas</h3></div>
            <div className="analytics-campaign-heading-actions">
              <div className="analytics-selection-actions" role="group" aria-label="Selecionar campanhas">
                <button type="button" className="analytics-text-button" onClick={() => setSelectedLeaves(allLeaves)}
                  disabled={pending || hierarchyLoading || selectedLeaves.length === allLeaves.length || !allLeaves.length}>Marcar todas</button>
                <button type="button" className="analytics-text-button" onClick={() => setSelectedLeaves([])}
                  disabled={pending || hierarchyLoading || !selectedLeaves.length}>Desmarcar todas</button>
              </div>
              <label className="analytics-search"><Search size={14} /><input type="search" value={campaignQuery}
                onChange={(event) => setCampaignQuery(event.target.value)} placeholder="Buscar campanha…" /></label>
            </div>
          </div>
          <div className="analytics-table-scroll"><table className="analytics-table analytics-campaign-table">
            <thead><tr><th scope="col" className="analytics-campaign-main-header"><div className="analytics-campaign-header-controls">
              <button type="button" onClick={() => sortBy("name")}>Selecionar · campanha / conta
                {sortKey === "name" && <ChevronDown size={12} style={{ transform: sortDirection === "asc" ? "rotate(180deg)" : undefined }} />}
              </button>
              <button type="button" className="analytics-status-sort-button" onClick={() => sortBy("status")}>Veiculação
                {sortKey === "status" && <ChevronDown size={12} style={{ transform: sortDirection === "asc" ? "rotate(180deg)" : undefined }} />}
              </button>
            </div></th>{campaignMetrics.map((metric) => <th scope="col" key={metric.key}
              draggable onDragStart={() => setDraggedMetricKey(metric.key)}
              onDragOver={(event) => event.preventDefault()} onDrop={() => moveCampaignMetric(metric.key)}
              className={draggedMetricKey === metric.key ? "is-dragging" : ""}>
              <button type="button" onClick={() => sortBy(metric.key)} title="Arraste para mudar a posição da coluna">{metric.label}
                {sortKey === metric.key && <ChevronDown size={12} style={{ transform: sortDirection === "asc" ? "rotate(180deg)" : undefined }} />}
              </button></th>)}</tr></thead>
            <CampaignTree entities={hierarchyEntities} roots={visibleCampaigns} metrics={campaignMetrics}
              selected={selectedLeaves} onChange={setSelectedLeaves} disabled={pending || hierarchyLoading}
              sortKey={sortKey} sortDirection={sortDirection} statusLabel={entityDeliveryLabel} />
          </table></div>
          {!roots.length && <p className="analytics-empty-copy">Nenhuma campanha em veiculação ou com valor gasto neste período.</p>}
          <p className="analytics-footnote">A seleção aplicada passa a controlar a Visão geral. Expanda as linhas para escolher conjuntos ou anúncios. Se não houver detalhamento, atualize os dados.</p>
        </article>
      </>}
      {tab === "metrics" && analyticsReady && <div className="analytics-metric-catalog">
        <label className="analytics-search"><Search size={14} /><input type="search" aria-label="Pesquisar métricas"
          value={metricSearch} onChange={event => setMetricSearch(event.target.value)} placeholder="Pesquisar métrica…" /></label>
        {["Investimento e eficiência", "Entrega e alcance", "Cliques e tráfego", "Resultados e ações", "Vídeo", "Engajamento e outros"].map((group) => {
          const groupMetrics = scopedData.metrics.filter((metric) => metricGroup(metric) === group
            && `${metric.label} ${metric.key}`.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR")
              .includes(metricSearch.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim()));
          if (!groupMetrics.length) return null;
          return <section className="analytics-metric-group" key={group}>
            <div className="analytics-metric-group-heading"><div><h3>{group}</h3></div>
              <span className="analytics-count">{groupMetrics.length}</span></div>
            <div className="analytics-kpi-grid">{groupMetrics.map((metric, index) => {
              const checked = optionalMetricKeys.includes(metric.key);
              const color = ANALYTICS_COLORS[index % ANALYTICS_COLORS.length];
              return <article className={`analytics-kpi analytics-metric-select-card${checked ? " is-selected" : ""}`}
                key={metric.key} style={{ "--metric-color": color } as CSSProperties}>
                <div className="analytics-kpi-top"><span>{metric.label}</span><label className="analytics-metric-checkbox">
                  <input type="checkbox" checked={checked} disabled={isPinned(metric.key)}
                    aria-label={`Adicionar ${metric.label} à Visão geral`}
                    onChange={() => toggleMetric(metric.key)} />
                  <span>{FIXED_METRICS.includes(metric.key) ? <Lock size={12} /> : <Check size={12} />}</span>
                </label></div>
                <strong title={scopedData.summary[metric.key] == null ? unavailableReason(scopedData, metric) : undefined} className={`analytics-kpi-value${scopedData.summary[metric.key] == null ? " is-unavailable" : ""}`}>
                  {formatAnalyticsValue(scopedData.summary[metric.key], metric, data.currency)}
                </strong>
                {estimatedMetric(scopedData, metric.key) && <small className="analytics-estimate">Estimado entre contas</small>}
                <p className="analytics-metric-card-note">{FIXED_METRICS.includes(metric.key) ? "Indicador fixo da Visão geral" : checked ? "Exibida na Visão geral" : "Marque para adicionar à Visão geral"}</p>
              </article>;
            })}</div>
          </section>;
        })}
      </div>}
      {tab === "reports" && <div className="analytics-reports-space">
        <section className="analytics-card analytics-report-list-card">
          <div className="analytics-card-heading"><div><h3>Relatórios {canManageReports ? "deste cliente" : "publicados"}</h3><p className="analytics-report-help">{canManageReports ? "Revise os arquivos gerados na Visão geral. Ao publicar, o relatório fica disponível na conta do cliente." : "Consulte e baixe os relatórios publicados para você."}</p></div>
            <select className="input" aria-label="Estado dos relatórios" value={reportState} onChange={event => setReportState(event.target.value)}>
              <option value="all">Todos os status</option><option value="published">Publicados</option>
              {canManageReports && <option value="ready">Não publicados</option>}<option value="superseded">Histórico</option>
            </select>
            <label className="analytics-search"><Search size={14} /><input type="search" value={reportSearch}
              onChange={(event) => setReportSearch(event.target.value)} placeholder="Buscar relatório…" aria-label="Buscar relatório" /></label>
          </div>
          {reportRows.length ? <div className="analytics-report-list">{reportRows.map((report) => <div className="analytics-report-row" key={report.reportVersionId}>
            <div><strong>{report.title}</strong>
              <span>{displayDate(report.dateFrom)} – {displayDate(report.dateTo)}</span>
              {report.orientation && <span>{report.orientation === "horizontal" ? "Horizontal · apresentação" : "Vertical · A4"}{report.generatedAt ? ` · Gerado em ${new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"America/Sao_Paulo"}).format(new Date(report.generatedAt))}` : ""}</span>}</div>
            <span className={`analytics-report-state is-${report.state}`}>
              {report.state === "ready" ? "Não publicado" : report.state === "published" ? "Publicado" : "Histórico"}
            </span>
            <div className="analytics-report-actions">
              <button type="button" className="analytics-button analytics-button-secondary" onClick={() => downloadReport(report.reportVersionId)} disabled={pending}><Download size={14} />Baixar PDF</button>
              {<Link className="analytics-button analytics-button-secondary"
                href={`/cliente/${clientId}/relatorios/${report.reportVersionId}`}>Visualizar</Link>}
              {canManageReports && report.state === "ready" && <button type="button" className="analytics-button analytics-button-primary"
                onClick={() => publishReport(report.reportVersionId)} disabled={pending}>Publicar</button>}
              {canManageReports && <button type="button" className="analytics-icon-danger" onClick={() => deleteReport(report.reportId)}
                aria-label={`Excluir ${report.title}`} disabled={pending}><Trash2 size={15} /><span>Excluir</span></button>}
            </div>
          </div>)}</div> : <p className="analytics-empty-copy">Nenhum relatório encontrado.</p>}
        </section>
      </div>}
    </div>

    {tab !== "reports" && <footer className="analytics-data-footer"><span><Check size={12} />Dados da plataforma · calendário local de cada conta</span>
      <span>Sem estimativas para datas não coletadas</span></footer>}
    <Dialog open={customizing} onOpenChange={setCustomizing} title="Personalizar relatório" description="Indicadores, cabeçalho e comentários usados na Visão geral e no PDF.">
      <div className="analytics-customize">
        <section><h3>Modelo de análise</h3>
          <div className="analytics-report-create-body">
            <p>Escolha um ponto de partida. Os filtros, os indicadores fixos e seus comentários serão preservados.</p>
            <div className="analytics-model-options">{ANALYSIS_MODELS.map(model => <button type="button" className="analytics-text-button" key={model.key} onClick={() => setOptionalMetricKeys(modelMetrics(model.metrics, scopedData.metrics.map(metric => metric.key)))}>{model.name}</button>)}</div>
            <p className="analytics-footnote">Cada modelo inclui somente métricas retornadas pela plataforma. A seleção e a ordem são salvas neste navegador para este cliente e usadas no PDF.</p>
            <ol className="analytics-metric-order">{optionalMetrics.map((metric, index) => <li key={metric.key}><span>{metric.label}</span><div><button type="button" className="analytics-text-button" disabled={index === 0} aria-label={`Mover ${metric.label} para antes`} onClick={() => setOptionalMetricKeys(keys => moveMetric(keys, metric.key, -1))}>↑</button><button type="button" className="analytics-text-button" disabled={index === optionalMetrics.length - 1} aria-label={`Mover ${metric.label} para depois`} onClick={() => setOptionalMetricKeys(keys => moveMetric(keys, metric.key, 1))}>↓</button></div></li>)}</ol>
          </div>
        </section>
        <section><h3>Cabeçalho do relatório</h3>
          <div className="analytics-report-create-body">
            <div className="analytics-report-header-fields">
              <label>Título do relatório<input className="input" aria-label="Título do relatório" value={reportTitle} maxLength={200} onChange={event => setReportTitle(event.target.value)} /></label>
              <label>Nome no cabeçalho<input className="input" value={headerName} maxLength={160} onChange={event => setHeaderName(event.target.value)} /></label>
              <label>Informações do responsável<textarea className="input" rows={2} value={headerDetails} maxLength={500} placeholder="Empresa, gestor, site ou contato" onChange={event => setHeaderDetails(event.target.value)} /></label>
            </div>
            <small>{canManageReports ? "O PDF será baixado e salvo em Relatórios. Publique após revisar para liberar o acesso ao cliente." : "O PDF será baixado para o seu dispositivo."}</small>
          </div>
        </section>
        {canManageReports && <section><h3>Comentários e próximos passos</h3><label htmlFor="analysis-note">Contextualize os resultados para o cliente</label><textarea id="analysis-note" className="input" rows={4} maxLength={5000} value={analysisNote} onChange={event => setAnalysisNote(event.target.value)} placeholder="O que aconteceu, o que merece atenção e quais serão as próximas ações." /><p className="analytics-footnote">Rascunho salvo neste navegador. Ao gerar, o comentário será preservado no relatório vertical ou horizontal.</p></section>}
      </div>
    </Dialog>
  </section>;
}
