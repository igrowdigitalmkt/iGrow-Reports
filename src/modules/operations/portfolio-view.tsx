import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleCheck, PlugZap, RefreshCw, Target, TrendingUp, WalletCards } from "lucide-react";
import { PortfolioSpendChart } from "./portfolio-chart";
import { ClientBalance } from "./portfolio-balance";

export type PortfolioStatus = "ok" | "no-accounts" | "no-delivery" | "cost-up" | "updating" | "unavailable";

export type PortfolioRow = {
  id: string;
  name: string;
  linkedAccounts: number;
  status: PortfolioStatus;
  currency: string | null;
  spend: number | null;
  previousSpend: number | null;
  reach: number | null;
  impressions: number | null;
  /** Every result type of the period, largest first. Costs only apply when there is one type. */
  results: PortfolioResult[];
  trend: number[];
  previousTrend: number[];
  /** Dates of `trend`, one per day. */
  days: string[];
  /** Demo only: balance shown without asking Meta. */
  demoBalance?: { funds: number | null; postpaid?: boolean };
};

export type PortfolioResult = { key: string; label: string; value: number; cost: number | null; previousCost: number | null };

export type PortfolioSummary = { rows: PortfolioRow[]; reportsGenerated: number | null; periodLabel: string };

const STATUS: Record<PortfolioStatus, { label: string; tone: string }> = {
  ok: { label: "Veiculando", tone: "green" },
  "no-accounts": { label: "Configurar Meta", tone: "amber" },
  "no-delivery": { label: "Sem veiculação", tone: "amber" },
  "cost-up": { label: "Custo em alta", tone: "amber" },
  updating: { label: "Atualizando", tone: "neutral" },
  unavailable: { label: "Indisponível", tone: "neutral" },
};

const integer = (value: number | null) => value == null ? "—" : Math.round(value).toLocaleString("pt-BR");
function money(value: number | null, currency: string | null) {
  if (value == null || !currency) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}
function change(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous * 100;
}

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className="delta">—</span>;
  const good = invert ? value < 0 : value > 0;
  return <span className={`delta ${Math.abs(value) < .05 ? "" : good ? "is-good" : "is-bad"}`}>
    {value > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
  </span>;
}

export function Sparkline({ values, width = 88, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2 || values.every(value => value === 0)) return <span className="muted">—</span>;
  const max = Math.max(...values), min = Math.min(...values, 0), pad = 3;
  const points = values.map((value, index) => [pad + index * (width - pad * 2) / (values.length - 1), pad + (height - pad * 2) * (1 - (value - min) / (max - min || 1))]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  return <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <path d={`${line} L${lastX.toFixed(1)} ${height} L${pad} ${height} Z`} className="sparkline-area" />
    <path d={line} className="sparkline-line" />
    <circle cx={lastX} cy={lastY} r="2.4" className="sparkline-dot" />
  </svg>;
}

function sum(rows: PortfolioRow[], key: "spend" | "previousSpend" | "reach" | "impressions") {
  const values = rows.map(row => row[key]).filter((value): value is number => value != null);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

export function PortfolioView({ summary, base, demo = false }: { summary: PortfolioSummary; base: string; demo?: boolean }) {
  const { rows } = summary;
  const measured = rows.filter(row => row.spend != null);
  const currencies = new Set(measured.map(row => row.currency));
  const currency = currencies.size === 1 ? [...currencies][0] : null;
  const spend = currency ? sum(measured, "spend") : null;
  const previousSpend = currency ? sum(measured, "previousSpend") : null;
  const attention = rows.filter(row => row.status !== "ok");
  const reach = sum(measured, "reach");
  const impressions = sum(measured, "impressions");
  // Daily series aligned by date across clients (account time zones can shift the range by a day).
  const days = [...new Set(measured.flatMap(row => row.days))].sort();
  const trend = days.map(day => measured.reduce((total, row) => total + (row.trend[row.days.indexOf(day)] ?? 0), 0));
  const longest = measured.reduce((size, row) => Math.max(size, row.previousTrend.length), 0);
  const previousTrend = measured.every(row => row.previousTrend.length === row.trend.length) && longest === days.length
    ? days.map((_, index) => measured.reduce((total, row) => total + (row.previousTrend[index] ?? 0), 0)) : [];
  const totals = new Map<string, { key: string; label: string; value: number }>();
  for (const row of measured) for (const result of row.results) {
    const current = totals.get(result.key) ?? { key: result.key, label: result.label, value: 0 };
    current.value += result.value;
    totals.set(result.key, current);
  }
  const allResults = [...totals.values()].sort((a, b) => b.value - a.value);
  const sorted = [...rows].sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
  const clientHref = (id: string) => demo ? `${base}/clientes` : `/dashboard/clientes/${id}`;

  return <>
    <div className="overview-kpis">
      <section className="panel metric-card overview-spend"><div className="metric-label"><span>Investimento na carteira</span></div><strong className="metric-value">{money(spend, currency)}</strong><div className="metric-foot"><Delta value={change(spend, previousSpend)} /><span>vs. período anterior</span></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Alcance</span></div><strong className="metric-value">{integer(reach)}</strong><div className="metric-foot"><span>soma das contas · pessoas podem se repetir entre clientes</span></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Impressões</span></div><strong className="metric-value">{integer(impressions)}</strong><div className="metric-foot"><span>todas as contas de anúncio</span></div></section>
      <section className="panel overview-results">
        <div className="metric-label"><span>Resultados</span><Target size={15} className="muted" /></div>
        {allResults.length ? <ul>{allResults.map(result => <li key={result.key}><span>{result.label}</span><strong>{integer(result.value)}</strong></li>)}</ul> : <p className="muted text-sm">Nenhum resultado no período.</p>}
      </section>
      <section className="panel overview-chart">
        <div className="panel-heading"><div><h2>Investimento por dia</h2><p>{summary.periodLabel} · todos os clientes{currency ? "" : " · moedas diferentes, gráfico indisponível"}</p></div></div>
        <div className="overview-chart-body">{currency ? <PortfolioSpendChart days={days} spend={trend} previous={previousTrend} currency={currency} /> : <div className="overview-chart-empty">Os clientes usam moedas diferentes.</div>}</div>
      </section>
    </div>
    <div className="portfolio-grid">
      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="panel-heading" style={{ paddingBottom: 12 }}><div><h2>Clientes</h2><p>{summary.periodLabel} · ordenados por investimento</p></div><Link className="button button-ghost button-sm" href={`${base}/clientes`}>Ver todos<ArrowUpRight size={14} /></Link></div>
        {rows.length ? <div className="table-scroll"><table className="data-table">
          <caption className="sr-only">Desempenho de cada cliente no período</caption>
          <thead><tr><th scope="col">Cliente</th><th scope="col">Situação</th><th scope="col" className="numeric">Investimento</th><th scope="col" className="numeric">Saldo disponível</th><th scope="col">Resultados no período</th><th scope="col">Tendência</th></tr></thead>
          <tbody>{sorted.map(row => <tr key={row.id}>
            <th scope="row" style={{ fontWeight: 400 }}><Link href={clientHref(row.id)} className="client-cell"><span className="client-avatar blue">{row.name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><span style={{ minWidth: 0 }}><strong>{row.name}</strong><small>{row.linkedAccounts ? `${row.linkedAccounts} ${row.linkedAccounts === 1 ? "conta" : "contas"} Meta` : "Sem contas Meta"}</small></span></Link></th>
            <td><span className={`badge ${STATUS[row.status].tone}`}><span className="status-dot" />{STATUS[row.status].label}</span></td>
            <td className="numeric">{money(row.spend, row.currency)}</td>
            <td className="numeric"><ClientBalance clientId={row.id} enabled={row.linkedAccounts > 0} demo={demo ? row.demoBalance ?? { funds: null, postpaid: true } : undefined} /></td>
            <td><Results row={row} /></td>
            <td><Sparkline values={row.trend} /></td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-state"><PlugZap size={22} /><h3>Nenhum cliente cadastrado</h3><p>Cadastre um cliente e associe as contas de anúncio dele para ver os resultados aqui.</p><Link className="button button-primary mt-2" href={`${base}/clientes`}>Cadastrar cliente</Link></div>}
      </section>
      <section className="panel attention-panel">
        <div className="panel-heading" style={{ paddingBottom: 12 }}><div><h2>Precisa de atenção</h2><p>{attention.length ? `${attention.length} ${attention.length === 1 ? "cliente" : "clientes"}` : "Nenhum alerta no período"}</p></div></div>
        <div className="attention-list">
        {attention.map(row => <Link key={row.id} href={row.status === "no-accounts" ? `${base}/clientes` : clientHref(row.id)} className="attention-item">
          <span className={`attention-icon ${row.status === "updating" || row.status === "unavailable" ? "neutral" : "amber"}`}>{row.status === "no-accounts" ? <PlugZap size={15} /> : row.status === "no-delivery" ? <WalletCards size={15} /> : row.status === "cost-up" ? <TrendingUp size={15} /> : row.status === "updating" ? <RefreshCw size={15} /> : <AlertTriangle size={15} />}</span>
          <span><strong>{row.name}</strong><small>{attentionText(row)}</small></span>
        </Link>)}
        {!attention.length && <div className="attention-item"><span className="attention-icon green"><CircleCheck size={15} /></span><span><strong>Tudo em ordem</strong><small>Todos os clientes estão veiculando com custo estável.</small></span></div>}
        </div>
      </section>
    </div>
  </>;
}

function attentionText(row: PortfolioRow) {
  switch (row.status) {
    case "no-accounts": return "Associe as contas de anúncio para acompanhar os resultados.";
    case "no-delivery": return "Nenhum investimento nos últimos 7 dias. Confira o saldo e as campanhas.";
    case "cost-up": {
      const result = row.results[0];
      const value = result ? change(result.cost, result.previousCost) : null;
      return `Custo por ${result?.label ?? "resultado"} subiu ${value == null ? "" : `${Math.round(value)}% `}em relação ao período anterior.`;
    }
    case "updating": return "A coleta do período ainda não terminou.";
    default: return "Não foi possível consultar os dados agora.";
  }
}

// All result types stay visible: up to three inline, the rest summarized with the full list on hover.
function Results({ row }: { row: PortfolioRow }) {
  if (row.spend == null) return <span className="muted">—</span>;
  if (!row.results.length) return <span className="muted">Sem resultados</span>;
  const single = row.results.length === 1 ? row.results[0] : null;
  const shown = row.results.slice(0, 3);
  const rest = row.results.slice(3);
  return <div className="result-list" title={row.results.map(result => `${integer(result.value)} ${result.label}`).join(" · ")}>
    {shown.map(result => <span key={result.key}><strong>{integer(result.value)}</strong> {result.label}</span>)}
    {rest.length > 0 && <span className="muted">+{rest.length} {rest.length === 1 ? "tipo" : "tipos"}</span>}
    {single?.cost != null && <span className="muted">{money(single.cost, row.currency)} por resultado</span>}
  </div>;
}
