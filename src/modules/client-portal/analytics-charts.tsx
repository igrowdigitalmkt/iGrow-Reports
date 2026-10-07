"use client";

import { useEffect, useRef, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";
import type { AnalyticsDashboardData, AnalyticsValues } from "./analytics-types";
import { resultBreakdown } from "./analytics-results";
import { DonutRing } from "./donut-ring";
import { formatAnalyticsValue } from "./analytics-format";

export { formatAnalyticsValue };

export type AnalyticsMetric = AnalyticsDashboardData["metrics"][number];
export const ANALYTICS_COLORS = ["#5b7cfa", "#3fc2d6", "#a594ff", "#3ccf8e", "#f0b44c", "#e57fa8"];
// Neutral axis and grid tones that read on both the dark and the light theme.
const AXIS_TEXT = "#8a93a3";
const GRID_LINE = "rgba(138, 147, 163, .18)";


// Match Ads Manager semantics for entities that had no delivery in the period:
// there is no result/cost denominator to show, so render a dash instead of
// suggesting that data collection failed.
export function formatEntityAnalyticsValue(values: AnalyticsValues, metric: AnalyticsMetric, currency: string | null) {
  const value = values[metric.key];
  if ((metric.key === "primary_results" || metric.key === "cost_per_result")
    && (values.spend ?? 0) === 0 && value == null) return "—";
  return formatAnalyticsValue(value, metric, currency);
}

// Result and cost cells name the outcome below the number (cadastros, mensagens, alcance...).
export function EntityMetricValue({ values, metric, currency }: { values: AnalyticsValues; metric: AnalyticsMetric; currency: string | null }) {
  const text = formatEntityAnalyticsValue(values, metric, currency);
  if (metric.key !== "primary_results" && metric.key !== "cost_per_result") return <>{text}</>;
  const types = resultBreakdown(values);
  const label = types.length === 1 ? types[0].label.toLocaleLowerCase("pt-BR") : types.length > 1 ? `${types.length} tipos de resultado` : null;
  return <><span className="analytics-cell-value">{text}</span>{label && <small className="analytics-cell-label">{label}</small>}</>;
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function axisValue(value: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ChartCanvas({ option, label, height = 280 }: { option: EChartsCoreOption; label: string; height?: number }) {
  const element = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    async function render() {
      try {
        const [core, charts, components, renderers] = await Promise.all([
          import("echarts/core"), import("echarts/charts"), import("echarts/components"), import("echarts/renderers"),
        ]);
        if (cancelled || !element.current) return;
        core.use([charts.LineChart, charts.PieChart, charts.BarChart, components.GridComponent, components.TooltipComponent, components.AriaComponent, renderers.CanvasRenderer]);
        const chart = core.init(element.current);
        chart.setOption({ ...option, animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches, animationDuration: 500, aria: { enabled: true, description: label } });
        const resize = new ResizeObserver(() => chart.resize());
        resize.observe(element.current);
        dispose = () => { resize.disconnect(); chart.dispose(); };
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void render();
    return () => { cancelled = true; dispose?.(); };
  }, [option, label]);

  return failed
    ? <div className="analytics-chart-fallback">O gráfico não pôde ser carregado. Consulte os valores na tabela abaixo.</div>
    : <div className="analytics-chart" ref={element} role="img" aria-label={label} style={{ height }} />;
}

const tooltip = { trigger: "axis", backgroundColor: "#171b23", borderColor: "#2c3340", textStyle: { color: "#e9ecf2", fontSize: 12 }, confine: true, renderMode: "richText" };

export function AnalyticsTrendChart({ data, metrics, comparison = true, height = 280, chartType = "line" }: { data: AnalyticsDashboardData; metrics: AnalyticsMetric[]; comparison?: boolean; height?: number; chartType?: "line" | "bar" }) {
  const previousAvailable = comparison && data.coverage.previousStatus === "complete";
  const series = metrics.flatMap((metric, index) => {
    const color = ANALYTICS_COLORS[index % ANALYTICS_COLORS.length];
    const current = {
      name: metric.label, type: chartType, yAxisIndex: index,
      data: data.daily.map((day) => day.values[metric.key] ?? null),
      smooth: .2, connectNulls: false, showSymbol: false, symbolSize: 6,
      lineStyle: { color, width: 2.2 }, itemStyle: { color, ...(chartType === "bar" ? { borderRadius: [3, 3, 0, 0] } : {}) },
      ...(chartType === "bar" ? { barMaxWidth: 18, barGap: "20%" } : {}),
      ...(index === 0 && chartType === "line" ? { areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "#5b7cfa33" }, { offset: 1, color: "#5b7cfa00" }] } } } : {}),
    };
    return previousAvailable ? [current, {
      name: `${metric.label} · período anterior`, type: chartType, yAxisIndex: index,
      data: data.daily.map((_, day) => data.previousDaily[day]?.values[metric.key] ?? null),
      smooth: .2, connectNulls: false, showSymbol: false,
      lineStyle: { color, width: 1.5, type: "dashed", opacity: .48 }, itemStyle: { color, ...(chartType === "bar" ? { opacity: .3, borderRadius: [3, 3, 0, 0] } : {}) },
      ...(chartType === "bar" ? { barMaxWidth: 18, barGap: "20%" } : {}),
    }] : [current];
  });
  const option: EChartsCoreOption = {
    backgroundColor: "transparent", tooltip,
    grid: { left: 52, right: metrics.length > 1 ? 55 : 20, top: 32, bottom: 32 },
    xAxis: { type: "category", boundaryGap: chartType === "bar", data: data.daily.map((day) => shortDate(day.date)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: AXIS_TEXT, fontSize: 11, hideOverlap: true } },
    yAxis: metrics.map((metric, index) => ({ type: "value", name: metric.unit === "currency" ? data.currency ?? "" : metric.unit === "percent" ? "%" : "", nameTextStyle: { color: AXIS_TEXT, fontSize: 11 }, position: index === 0 ? "left" : "right", axisLabel: { color: AXIS_TEXT, fontSize: 11, formatter: axisValue }, splitLine: { show: index === 0, lineStyle: { color: GRID_LINE } } })),
    series,
  };
  const label = `Gráfico de ${chartType === "bar" ? "barras" : "linhas"}. Evolução diária de ${metrics.map((metric) => metric.label).join(" e ")}, de ${data.dateFrom} a ${data.dateTo}. Valores e datas estão disponíveis na tabela.`;
  return <>
    <ChartCanvas option={option} label={label} height={height} />
    <details className="analytics-chart-data">
      <summary>Consultar dados do gráfico</summary>
      <div className="analytics-table-scroll"><table className="analytics-table">
        <caption className="sr-only">Valores diários de desempenho e comparação por posição no intervalo</caption>
        <thead><tr><th scope="col">Data</th>{metrics.map((metric) => <th scope="col" key={metric.key}>{metric.label}</th>)}{previousAvailable && <th scope="col">Data anterior</th>}{previousAvailable && metrics.map((metric) => <th scope="col" key={`previous-${metric.key}`}>{metric.label} anterior</th>)}</tr></thead>
        <tbody>{data.daily.map((day, index) => <tr key={day.date}><th scope="row">{shortDate(day.date)}</th>{metrics.map((metric) => <td key={metric.key}>{formatAnalyticsValue(day.values[metric.key], metric, data.currency)}</td>)}{previousAvailable && <td>{data.previousDaily[index] ? shortDate(data.previousDaily[index].date) : "Indisponível"}</td>}{previousAvailable && metrics.map((metric) => <td key={`previous-${metric.key}`}>{formatAnalyticsValue(data.previousDaily[index]?.values[metric.key], metric, data.currency)}</td>)}</tr>)}</tbody>
      </table></div>
    </details>
  </>;
}

export function AnalyticsAccountChart({ data, metric }: { data: AnalyticsDashboardData; metric: AnalyticsMetric }) {
  const rows = data.accountTotals.filter((account) => account.values[metric.key] != null);
  const slices = rows.map((account, index) => ({ key: account.id, value: Math.max(account.values[metric.key] ?? 0, 0), color: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length],
    title: `${account.name}: ${formatAnalyticsValue(account.values[metric.key], metric, account.currency || data.currency)}` }));
  const total = rows.reduce((sum, account) => sum + (account.values[metric.key] ?? 0), 0);
  return <>
    {data.currency && <div className="analytics-donut-wrapper analytics-account-ring">
      <DonutRing slices={slices} label={`${metric.label} por conta de anúncios. Consulte os valores na lista abaixo.`} />
      <div className="analytics-donut-center"><small>{metric.label}</small><strong>{formatAnalyticsValue(data.summary[metric.key], metric, data.currency)}</strong><span>{rows.length} {rows.length === 1 ? "conta" : "contas"}</span></div>
    </div>}
    {!data.currency && rows.length > 0 && <p className="analytics-empty-copy">Contas com moedas diferentes. Os investimentos são apresentados separadamente.</p>}
    <ul className="analytics-account-legend">{rows.map((account, index) => <li key={account.id}>
      <span className="analytics-dot" style={{ background: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] }} />
      <span className="analytics-account-label">{account.name}</span><strong>{formatAnalyticsValue(account.values[metric.key], metric, account.currency || data.currency)}</strong>
      {data.currency && total > 0 && <small>{((account.values[metric.key] ?? 0) / total * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</small>}
    </li>)}</ul>
    {!rows.length && <p className="analytics-empty-copy">Sem valores disponíveis para distribuir por conta.</p>}
  </>;
}

export function AnalyticsSparkline({ values, color }: { values: (number | null | undefined)[]; color: string }) {
  const available = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!available.length) return <div className="analytics-spark-empty" />;
  const min = Math.min(...available);
  const max = Math.max(...available);
  const scale = max - min || 1;
  let path = "";
  let gap = true;
  values.forEach((value, index) => {
    if (value == null) { gap = true; return; }
    const x = index / Math.max(1, values.length - 1) * 160;
    const y = 36 - (value - min) / scale * 28;
    path += `${gap ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
    gap = false;
  });
  const continuous = values.every(value => value != null);
  const area = continuous ? `${path}L160,42 L0,42 Z` : "";
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return <svg className="analytics-sparkline" viewBox="0 0 160 42" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    {area && <path d={area} fill={`url(#${id})`} />}
    <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}
