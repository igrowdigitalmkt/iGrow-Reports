"use client";

import { useEffect, useRef, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";
import type { AnalyticsDashboardData } from "./analytics-types";

export type AnalyticsMetric = AnalyticsDashboardData["metrics"][number];
export const ANALYTICS_COLORS = ["#48d5f0", "#a293ff", "#53e6af", "#f2bc69", "#f08ebe", "#649aff"];

export function formatAnalyticsValue(value: number | null | undefined, metric: AnalyticsMetric, currency: string | null) {
  if (value == null || !Number.isFinite(value)) return "Indisponível";
  if (metric.unit === "currency" && !currency) return "Indisponível";
  try {
    const number = new Intl.NumberFormat("pt-BR", {
      ...(metric.unit === "currency" ? { style: "currency", currency: currency! } : {}),
      minimumFractionDigits: metric.precision,
      maximumFractionDigits: metric.precision,
    }).format(value);
    return metric.unit === "percent" ? `${number}%` : metric.unit === "ratio" ? `${number}×` : number;
  } catch {
    return "Indisponível";
  }
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

const tooltip = { trigger: "axis", backgroundColor: "#172232", borderColor: "#32465f", textStyle: { color: "#edf5ff", fontSize: 12 }, confine: true, renderMode: "richText" };

export function AnalyticsTrendChart({ data, metrics, comparison = true, height = 280 }: { data: AnalyticsDashboardData; metrics: AnalyticsMetric[]; comparison?: boolean; height?: number }) {
  const previousAvailable = comparison && data.coverage.previousStatus === "complete";
  const series = metrics.flatMap((metric, index) => {
    const color = ANALYTICS_COLORS[index % ANALYTICS_COLORS.length];
    const current = {
      name: metric.label, type: "line", yAxisIndex: index,
      data: data.daily.map((day) => day.values[metric.key] ?? null),
      smooth: .2, connectNulls: false, showSymbol: false, symbolSize: 6,
      lineStyle: { color, width: 2.8 }, itemStyle: { color },
      ...(index === 0 ? { areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "#48d5f026" }, { offset: 1, color: "#48d5f000" }] } } } : {}),
    };
    return previousAvailable ? [current, {
      name: `${metric.label} · período anterior`, type: "line", yAxisIndex: index,
      data: data.daily.map((_, day) => data.previousDaily[day]?.values[metric.key] ?? null),
      smooth: .2, connectNulls: false, showSymbol: false,
      lineStyle: { color, width: 1.5, type: "dashed", opacity: .48 }, itemStyle: { color },
    }] : [current];
  });
  const option: EChartsCoreOption = {
    backgroundColor: "transparent", tooltip,
    grid: { left: 52, right: metrics.length > 1 ? 55 : 20, top: 32, bottom: 32 },
    xAxis: { type: "category", boundaryGap: false, data: data.daily.map((day) => shortDate(day.date)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#9aadc4", fontSize: 10, hideOverlap: true } },
    yAxis: metrics.map((metric, index) => ({ type: "value", name: metric.unit === "currency" ? data.currency ?? "" : metric.unit === "percent" ? "%" : "", nameTextStyle: { color: "#94a7be", fontSize: 10 }, position: index === 0 ? "left" : "right", axisLabel: { color: "#9aadc4", fontSize: 10, formatter: axisValue }, splitLine: { show: index === 0, lineStyle: { color: "#243347", type: "dashed" } } })),
    series,
  };
  const label = `Evolução diária de ${metrics.map((metric) => metric.label).join(" e ")}, de ${data.dateFrom} a ${data.dateTo}. Valores e datas estão disponíveis na tabela.`;
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
  const values = rows.map((account, index) => ({ name: account.name, value: account.values[metric.key], itemStyle: { color: ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] } }));
  const option: EChartsCoreOption = {
    backgroundColor: "transparent",
    tooltip: { ...tooltip, trigger: "item", formatter: "{b}\n{c}" },
    series: [{ type: "pie", radius: ["59%", "78%"], center: ["50%", "50%"], stillShowZeroSum: false, avoidLabelOverlap: true, label: { show: false }, emphasis: { label: { show: false }, scale: true }, itemStyle: { borderColor: "#121d2b", borderWidth: 4, borderRadius: 5 }, data: values }],
  };
  const total = rows.reduce((sum, account) => sum + (account.values[metric.key] ?? 0), 0);
  return <>
    {data.currency && <div className="analytics-donut-wrapper">
      <ChartCanvas option={option} label={`${metric.label} por conta de anúncios. Consulte os valores na lista abaixo.`} height={218} />
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
  return <svg className="analytics-sparkline" viewBox="0 0 160 42" preserveAspectRatio="none" aria-hidden="true"><path d={path} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" /></svg>;
}
