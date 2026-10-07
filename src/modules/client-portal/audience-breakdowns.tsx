"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Globe2, Loader2, MapPin, RefreshCw } from "lucide-react";
import type { AudienceRow, ClientAudienceBreakdowns } from "@/modules/meta/server";
import { ANALYTICS_COLORS } from "./analytics-charts";

type Metric = "impressions" | "reach" | "clicks" | "spend" | "results";
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "impressions", label: "Impressões" }, { key: "reach", label: "Alcance" }, { key: "clicks", label: "Cliques" },
  { key: "spend", label: "Investimento" }, { key: "results", label: "Resultados" },
];
// Platform colors close to each brand; other dimensions use the dashboard palette.
const PLATFORM_COLORS: Record<string, string> = { instagram: "#c45ad6", facebook: "#5b7cfa", messenger: "#3fc2d6", audience_network: "#f0b44c", whatsapp: "#3ccf8e", threads: "#8a93a3" };
const GENDER_COLORS: Record<string, string> = { female: "#e57fa8", male: "#5b9cf2", unknown: "#8a93a3" };

type State = { status: "loading" } | { status: "ready"; data: ClientAudienceBreakdowns } | { status: "error"; message: string };

function formatter(metric: Metric, currency: string | null, compact: boolean) {
  const options: Intl.NumberFormatOptions = compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: metric === "spend" ? 2 : 0, minimumFractionDigits: metric === "spend" ? 2 : 0 };
  const format = new Intl.NumberFormat("pt-BR", metric === "spend" && currency ? { ...options, style: "currency", currency } : options);
  return (value: number) => format.format(value);
}

const MAX_SLICES = 7;
const countryNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });
// Meta returns ISO codes (BR, PT); show the country name when the code is known.
function countryName(code: string) { try { return /^[A-Z]{2}$/.test(code) ? countryNames.of(code) : undefined; } catch { return undefined; } }

function Donut({ title, rows, metric, colors, currency, action, emptyText }: { title: string; rows: AudienceRow[]; metric: Metric; colors?: Record<string, string>; currency: string | null; action?: ReactNode; emptyText?: string }) {
  const label = METRICS.find(item => item.key === metric)!.label;
  const sorted = rows.map(row => ({ key: row.key, label: row.label, value: row[metric] })).filter(item => item.value > 0).sort((a, b) => b.value - a.value);
  // Long lists (regions, countries) keep the largest slices and group the rest as "Outros".
  const grouped = sorted.length > MAX_SLICES
    ? [...sorted.slice(0, MAX_SLICES - 1), { key: "__outros", label: "Outros", value: sorted.slice(MAX_SLICES - 1).reduce((sum, item) => sum + item.value, 0) }]
    : sorted;
  const items = grouped.map((item, index) => ({ ...item, color: item.key === "__outros" ? "#8a93a3" : colors?.[item.key] ?? ANALYTICS_COLORS[index % ANALYTICS_COLORS.length] }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const radius = 52; const circumference = 2 * Math.PI * radius;
  const compact = formatter(metric, currency, true);
  // Start of each slice along the ring, in the same order as the items.
  const starts = items.map((_, index) => items.slice(0, index).reduce((sum, item) => sum + item.value / total * circumference, 0));
  return <article className="analytics-card audience-card">
    <div className="analytics-card-heading"><div><h3>{title}</h3></div>{action}</div>
    {total > 0 ? <div className="audience-donut">
      <svg viewBox="0 0 132 132" role="img" aria-label={`${title}: ${items.map(item => `${item.label} ${compact(item.value)}`).join(", ")}`}>
        <circle cx="66" cy="66" r={radius} className="audience-track" />
        {items.map((item, index) => {
          const length = item.value / total * circumference;
          return <circle key={item.key} cx="66" cy="66" r={radius} stroke={item.color} strokeDasharray={`${Math.max(length - 1.5, 0.5)} ${circumference}`} strokeDashoffset={-starts[index]} className="audience-segment"><title>{`${item.label}: ${compact(item.value)}`}</title></circle>;
        })}
        <text x="66" y="64" className="audience-total">{compact(total)}</text>
        <text x="66" y="82" className="audience-total-label">{label}</text>
      </svg>
      <ul className="audience-legend">{items.map(item => <li key={item.key}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{compact(item.value)}</strong></li>)}</ul>
    </div> : <p className="analytics-empty-copy">{emptyText ?? `Sem dados de ${label.toLowerCase()} no período.`}</p>}
  </article>;
}

// Audience of the period (platform, gender, age, region/country) with one indicator for every chart.
export function AudienceBreakdowns({ clientId, dateFrom, dateTo, accountIds, demoData }: { clientId: string; dateFrom: string; dateTo: string; accountIds: string[]; demoData?: ClientAudienceBreakdowns }) {
  const [metric, setMetric] = useState<Metric>("impressions");
  const [place, setPlace] = useState<"region" | "country">("region");
  const [state, setState] = useState<State>(demoData ? { status: "ready", data: demoData } : { status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const accountsKey = accountIds.join(",");

  useEffect(() => {
    if (demoData) return;
    let cancelled = false;
    const query = new URLSearchParams({ from: dateFrom, to: dateTo, ...(accountsKey ? { contas: accountsKey } : {}) });
    fetch(`/api/clientes/${clientId}/audiencia?${query}`, { cache: "no-store" }).then(response => response.json()).then((body: ClientAudienceBreakdowns & { error?: string }) => {
      if (!cancelled) setState(body.error ? { status: "error", message: body.error } : { status: "ready", data: body });
    }).catch(() => { if (!cancelled) setState({ status: "error", message: "Não foi possível consultar a Meta agora." }); });
    return () => { cancelled = true; };
  }, [clientId, dateFrom, dateTo, accountsKey, demoData, attempt]);

  const data = state.status === "ready" ? state.data : null;
  const currency = data?.currency ?? null;

  return <section className="audience-section" aria-label="Público do período">
    <div className="audience-head">
      <div><h3>Público do período</h3><p>Plataformas, gênero, idade e local, direto da Meta</p></div>
      <label className="analytics-chart-metric"><span>Indicador</span>
        <select className="input" value={metric} onChange={event => setMetric(event.target.value as Metric)}>{METRICS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
      </label>
    </div>
    {state.status === "loading" && <div className="audience-loading"><Loader2 size={16} className="spin" />Consultando o público na Meta…</div>}
    {state.status === "error" && <div className="audience-loading">{state.message}<button type="button" className="analytics-text-button" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}><RefreshCw size={12} />Tentar de novo</button></div>}
    {data && <>
      <div className="audience-grid">
        <Donut title="Plataformas" rows={data.platforms} metric={metric} colors={PLATFORM_COLORS} currency={currency} />
        <Donut title="Gênero" rows={data.gender} metric={metric} colors={GENDER_COLORS} currency={currency} />
        <Donut title="Idade" rows={data.age} metric={metric} currency={currency} />
        <Donut title={place === "region" ? "Região" : "País"} rows={place === "country" ? data.country.map(row => ({ ...row, label: countryName(row.key) ?? row.label })) : data.region} metric={metric} currency={currency}
          emptyText={metric === "results" ? `A Meta não informa resultados por ${place === "region" ? "região" : "país"}.` : undefined}
          action={<div className="analytics-chart-switcher" role="group" aria-label="Local">
            <button type="button" aria-pressed={place === "region"} className={place === "region" ? "is-active" : ""} onClick={() => setPlace("region")}><MapPin size={12} />Região</button>
            <button type="button" aria-pressed={place === "country"} className={place === "country" ? "is-active" : ""} onClick={() => setPlace("country")}><Globe2 size={12} />País</button>
          </div>} />
      </div>
    </>}
  </section>;
}
