"use client";

import { useEffect, useRef } from "react";
import { init, use as registerECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, AriaComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { useTheme } from "next-themes";
import type { DashboardSnapshot } from "@/modules/operations/dashboard-data";

registerECharts([LineChart, GridComponent, TooltipComponent, AriaComponent, CanvasRenderer]);

export default function ActivityChart({ data }: { data: DashboardSnapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    const light = resolvedTheme === "light";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 450,
      aria: { enabled: true, description: "Atividade fictícia por dia. Relatórios gerados e mensagens entregues são quantidades distintas. Os totais estão disponíveis nos indicadores e na tabela de dados." },
      grid: { left: 35, right: 15, top: 20, bottom: 27 },
      tooltip: { trigger: "axis", backgroundColor: light ? "#fff" : "#19212e", borderColor: light ? "#d5dce7" : "#313c50", textStyle: { color: light ? "#142031" : "#e4eaf3", fontFamily: "var(--font-geist-sans)" }, confine: true },
      xAxis: { type: "category", boundaryGap: false, data: data.labels, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#7e8b9f", fontSize: 10, margin: 16, interval: data.labels.length > 7 ? 4 : 0 } },
      yAxis: { type: "value", minInterval: 1, axisLabel: { color: "#7e8b9f", fontSize: 10 }, splitLine: { lineStyle: { color: light ? "#e7eaf0" : "#242d3b", type: "dashed" } } },
      series: [
        { name: "Relatórios gerados", type: "line", data: data.generatedSeries, smooth: .3, symbol: "circle", showSymbol: false, symbolSize: 6, lineStyle: { width: 2.5, color: "#747bff" }, itemStyle: { color: "#747bff" }, areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(116,123,255,.2)" }, { offset: 1, color: "rgba(116,123,255,0)" }] } } },
        { name: "Mensagens entregues", type: "line", data: data.deliveredSeries, smooth: .3, showSymbol: false, lineStyle: { width: 2, color: "#3ac8d4" }, itemStyle: { color: "#3ac8d4" } },
      ],
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    return () => { resize.disconnect(); chart.dispose(); };
  }, [data, resolvedTheme]);

  return <><div ref={ref} className="activity-chart" role="img" aria-label="Gráfico de atividade diária demonstrativa" /><details className="chart-data"><summary>Consultar dados do gráfico</summary><div className="table-scroll"><table><caption className="sr-only">Atividade diária fictícia</caption><thead><tr><th>Data</th><th>Relatórios</th><th>Mensagens entregues</th></tr></thead><tbody>{data.labels.map((label, i) => <tr key={label}><td>{label}</td><td>{data.generatedSeries[i]}</td><td>{data.deliveredSeries[i]}</td></tr>)}</tbody></table></div></details></>;
}
