"use client";

import { useState, useTransition } from "react";
import "./snapshot-series.css";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import type { SnapshotSeriesData } from "./snapshot-series-loader";
import type { SeriesChartMetric } from "@/components/charts/snapshot-series-chart";
import { requestSeriesData } from "./snapshot-series-actions";
import { metaMetricLabel } from "@/modules/meta/metric-labels";

// Lazy-load ECharts to avoid increasing the main bundle
const SnapshotSeriesChart = dynamic(
  () => import("@/components/charts/snapshot-series-chart").then(m => ({ default: m.SnapshotSeriesChart })),
  { ssr: false, loading: () => <div className="snapshot-series-chart-placeholder" aria-busy="true" /> },
);

// Keys shown in the metric selector; kept to the most actionable indicators.
const DEFAULT_DISPLAY_KEYS = ["spend", "impressions", "reach", "clicks", "link_clicks", "inline_link_clicks", "leads", "purchases", "cpm", "ctr", "cpc"];

function niceLabel(nativeKey: string): string {
  const key = nativeKey === "inline_link_clicks" ? "link_clicks" : nativeKey;
  const indicator = nativeKey.startsWith("result:provider:") ? nativeKey.slice("result:provider:".length) : key;
  const label = metaMetricLabel(indicator, indicator);
  if (label === indicator) {
    // Fallback: prettify the key
    return nativeKey.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }
  return label;
}

export function SnapshotSeriesPanel({
  clientId,
  accountId,
  dateFrom,
  dateTo,
  canCollect,
  series,
  tooManyDays,
  maxDays,
}: {
  clientId: string;
  accountId: string;
  dateFrom: string;
  dateTo: string;
  canCollect: boolean;
  series: SnapshotSeriesData | null;
  tooManyDays: number | null;
  maxDays: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Determine available metrics from series data
  const availableKeys = series
    ? series.keys.filter(k => DEFAULT_DISPLAY_KEYS.includes(k) || k.startsWith("result:"))
    : [];
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => {
    // Default selection: spend + up to 1 result metric
    const keys: string[] = [];
    if (availableKeys.includes("spend")) keys.push("spend");
    const result = availableKeys.find(k => k.startsWith("result:provider:") || k === "leads" || k === "purchases");
    if (result && result !== "spend") keys.push(result);
    return keys.length ? keys : availableKeys.slice(0, 2);
  });

  const missingCount = series?.missingDates.length ?? 0;
  const totalDays = series?.points.length ?? 0;
  const readyDays = totalDays - missingCount;

  const metrics: SeriesChartMetric[] = selectedKeys.map(key => {
    const unit = series?.units[key] ?? (
      key === "spend" || key.startsWith("cost") || key === "cpc" || key === "cpp" || key === "cpm" ? "currency"
      : key === "ctr" || key === "frequency" || key.includes("ctr") ? "percent"
      : "count"
    );
    return { nativeKey: key, label: niceLabel(key), unit, currency: series?.currency ?? null };
  });

  function requestCollection() {
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await requestSeriesData({ clientId, accountId, from: dateFrom, to: dateTo });
        if ("error" in result) { setError(result.error ?? "Não foi possível solicitar os dados."); return; }
        setMessage(`Coleta solicitada para ${result.created} dias. Aguarde a confirmação.`);
        router.refresh();
      } catch { setError("Não foi possível solicitar os dados. Tente novamente."); }
    });
  }

  if (tooManyDays !== null) {
    return (
      <div className="snapshot-series">
        <div className="snapshot-series-header"><TrendingUp size={18} /><h2>Evolução diária</h2></div>
        <p className="snapshot-series-note">
          O período selecionado tem {tooManyDays} dias. A série diária suporta até {maxDays} dias.
          Selecione um período menor para visualizar a evolução.
        </p>
      </div>
    );
  }

  if (!series) {
    return (
      <div className="snapshot-series">
        <div className="snapshot-series-header"><TrendingUp size={18} /><h2>Evolução diária</h2></div>
        <p className="snapshot-series-note">Não foi possível carregar a série diária. A configuração da integração pode estar incompleta.</p>
      </div>
    );
  }

  return (
    <div className="snapshot-series">
      <div className="snapshot-series-header"><TrendingUp size={18} /><h2>Evolução diária</h2>
        {readyDays > 0 && <span className="snapshot-series-coverage">{readyDays} de {totalDays} dias confirmados</span>}
      </div>

      {message && <p role="status" className="snapshot-series-msg">{message}</p>}
      {error && <p role="alert" className="snapshot-series-msg snapshot-series-error">{error}</p>}

      {missingCount > 0 && (
        <div className="snapshot-series-missing">
          <p>{missingCount === totalDays
            ? "Nenhum dia deste período tem dados confirmados na série diária."
            : `${missingCount} ${missingCount === 1 ? "dia ainda não tem" : "dias ainda não têm"} dados confirmados e ${missingCount === 1 ? "aparece" : "aparecem"} como lacuna no gráfico.`}
          </p>
          {canCollect && (
            <button type="button" disabled={pending} onClick={requestCollection}>
              {pending ? "Solicitando…" : "Solicitar coleta dos dias ausentes"}
            </button>
          )}
        </div>
      )}

      {availableKeys.length > 0 && (
        <div className="snapshot-series-selector">
          <label htmlFor="series-metrics-select">Indicadores exibidos</label>
          <select
            id="series-metrics-select"
            multiple
            size={Math.min(availableKeys.length, 6)}
            value={selectedKeys}
            onChange={e => {
              const next = Array.from(e.target.selectedOptions, o => o.value);
              if (next.length) setSelectedKeys(next);
            }}
          >
            {availableKeys.map(key => (
              <option key={key} value={key}>{niceLabel(key)}</option>
            ))}
          </select>
          <small>Segure Ctrl / Cmd para selecionar vários.</small>
        </div>
      )}

      {readyDays > 0 && metrics.length > 0 ? (
        <SnapshotSeriesChart
          points={series.points}
          metrics={metrics}
          currency={series.currency}
        />
      ) : (
        <div className="snapshot-series-empty">
          <p>Nenhum dado confirmado para exibir no gráfico.</p>
        </div>
      )}
    </div>
  );
}
