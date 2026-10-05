"use client";

import { useEffect, useRef } from "react";
import { init, use as registerECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useTheme } from "next-themes";
import type { SnapshotSeriesPoint } from "@/modules/client-portal/snapshot-series-loader";
import { formatSnapshotDecimal } from "@/modules/meta/snapshot-format";

registerECharts([LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, CanvasRenderer]);

const SERIES_COLORS = [
  "#747bff", "#3ac8d4", "#f5a623", "#e84393", "#2ecc71", "#e74c3c", "#9b59b6", "#1abc9c",
];

export type SeriesChartMetric = {
  nativeKey: string;
  label: string;
  unit: string;
  currency: string | null;
};

export function SnapshotSeriesChart({
  points,
  metrics,
  currency,
}: {
  points: SnapshotSeriesPoint[];
  metrics: SeriesChartMetric[];
  currency: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!ref.current || !points.length || !metrics.length) return;
    const chart = init(ref.current);
    const light = resolvedTheme === "light";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const labels = points.map(p => {
      const parts = p.date.split("-");
      return `${parts[2]}/${parts[1]}`;
    });

    const series = metrics.map((metric, i) => ({
      name: metric.label,
      type: "line" as const,
      data: points.map(p => {
        const raw = p.values[metric.nativeKey];
        if (raw === null || raw === undefined || p.status !== "ready") return null;
        // Parse to float for chart rendering; precision is only for display
        const n = parseFloat(raw);
        return Number.isFinite(n) ? n : null;
      }),
      smooth: 0.3,
      symbol: "circle",
      showSymbol: points.length <= 14,
      symbolSize: 5,
      lineStyle: { width: 2.5, color: SERIES_COLORS[i % SERIES_COLORS.length] },
      itemStyle: { color: SERIES_COLORS[i % SERIES_COLORS.length] },
      connectNulls: false,
      areaStyle: metrics.length === 1 ? {
        color: {
          type: "linear" as const, x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: `${SERIES_COLORS[0]}33` },
            { offset: 1, color: `${SERIES_COLORS[0]}00` },
          ],
        },
      } : undefined,
    }));

    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 450,
      aria: { enabled: true, description: `Evolução diária de ${metrics.map(m => m.label).join(", ")} ao longo do período selecionado.` },
      grid: { left: 50, right: 15, top: metrics.length > 1 ? 40 : 20, bottom: 30 },
      legend: metrics.length > 1 ? { bottom: "auto", top: 0, textStyle: { color: light ? "#142031" : "#e4eaf3", fontFamily: "var(--font-geist-sans)", fontSize: 11 } } : { show: false },
      tooltip: {
        trigger: "axis",
        backgroundColor: light ? "#fff" : "#19212e",
        borderColor: light ? "#d5dce7" : "#313c50",
        textStyle: { color: light ? "#142031" : "#e4eaf3", fontFamily: "var(--font-geist-sans)", fontSize: 12 },
        confine: true,
        formatter: (params: unknown) => {
          const items = params as Array<{ name: string; seriesName: string; value: number | null; marker: string; dataIndex: number }>;
          if (!items.length) return "";
          const point = points[items[0].dataIndex];
          const dateLabel = point ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${point.date}T12:00:00Z`)) : items[0].name;
          const rows = items.map(item => {
            if (item.value === null) return `${item.marker}${item.seriesName}: <b>—</b>`;
            const metric = metrics.find(m => m.label === item.seriesName);
            const raw = point?.values[metric?.nativeKey ?? ""] ?? null;
            const formatted = raw !== null && metric ? formatSnapshotDecimal(raw, metric.unit, currency) : String(item.value);
            return `${item.marker}${item.seriesName}: <b>${formatted}</b>`;
          }).join("<br/>");
          return `${dateLabel}<br/>${rows}`;
        },
      },
      xAxis: {
        type: "category", boundaryGap: false, data: labels,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: "#7e8b9f", fontSize: 10, margin: 14, interval: Math.max(0, Math.floor(labels.length / 10) - 1) },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: "#7e8b9f", fontSize: 10 },
        splitLine: { lineStyle: { color: light ? "#e7eaf0" : "#242d3b", type: "dashed" } },
      },
      series,
    });

    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [points, metrics, currency, resolvedTheme]);

  if (!points.length || !metrics.length) return null;

  return (
    <>
      <div ref={ref} className="snapshot-series-chart" role="img" aria-label={`Gráfico de evolução diária: ${metrics.map(m => m.label).join(", ")}`} />
      <details className="chart-data">
        <summary>Consultar dados da série</summary>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Evolução diária de indicadores</caption>
            <thead>
              <tr>
                <th>Data</th>
                {metrics.map(m => <th key={m.nativeKey}>{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {points.map(p => (
                <tr key={p.date}>
                  <td>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${p.date}T12:00:00Z`))}</td>
                  {metrics.map(m => (
                    <td key={m.nativeKey}>
                      {p.status === "empty" ? "Sem veiculação" : p.status !== "ready" ? "—" : formatSnapshotDecimal(p.values[m.nativeKey] ?? null, m.unit, currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
