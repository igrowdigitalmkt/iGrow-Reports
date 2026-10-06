import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleCheck, PlugZap, RefreshCw, TrendingUp, WalletCards } from "lucide-react";

export type PortfolioStatus = "ok" | "no-accounts" | "no-delivery" | "cost-up" | "updating" | "unavailable";

export type PortfolioRow = {
  id: string;
  name: string;
  linkedAccounts: number;
  status: PortfolioStatus;
  currency: string | null;
  resultLabel: string;
  spend: number | null;
  previousSpend: number | null;
  results: number | null;
  previousResults: number | null;
  trend: number[];
};

export type PortfolioSummary = { rows: PortfolioRow[]; reportsGenerated: number | null; periodLabel: string };

const STATUS: Record<PortfolioStatus, { label: string; tone: string }> = {
  ok: { label: "Entregando", tone: "green" },
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
const costPerResult = (spend: number | null, results: number | null) => spend != null && results ? spend / results : null;
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

function sum(rows: PortfolioRow[], key: "spend" | "previousSpend" | "results" | "previousResults") {
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
  const results = sum(measured, "results");
  const previousResults = sum(measured, "previousResults");
  const attention = rows.filter(row => row.status !== "ok");
  const trend = measured.length ? measured[0].trend.map((_, index) => measured.reduce((total, row) => total + (row.trend[index] ?? 0), 0)) : [];
  const sorted = [...rows].sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
  const clientHref = (id: string) => demo ? `${base}/clientes` : `/dashboard/clientes/${id}`;

  return <>
    <div className="stats-grid">
      <section className="panel metric-card"><div className="metric-label"><span>Investimento na carteira</span></div><strong className="metric-value">{money(spend, currency)}</strong><div className="metric-foot"><Delta value={change(spend, previousSpend)} /><span>vs. anterior</span><Sparkline values={trend} /></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Resultados</span></div><strong className="metric-value">{integer(results)}</strong><div className="metric-foot"><Delta value={change(results, previousResults)} /><span>vs. anterior</span></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Custo médio por resultado</span></div><strong className="metric-value">{money(costPerResult(spend, results), currency)}</strong><div className="metric-foot"><Delta value={change(costPerResult(spend, results), costPerResult(previousSpend, previousResults))} invert /><span>vs. anterior</span></div></section>
      <section className="panel metric-card"><div className="metric-label"><span>Relatórios gerados</span></div><strong className="metric-value">{integer(summary.reportsGenerated)}</strong><div className="metric-foot"><span>{summary.periodLabel}</span></div></section>
    </div>
    <div className="portfolio-grid">
      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="panel-heading" style={{ paddingBottom: 12 }}><div><h2>Clientes</h2><p>{summary.periodLabel} · ordenados por investimento</p></div><Link className="button button-ghost button-sm" href={`${base}/clientes`}>Ver todos<ArrowUpRight size={14} /></Link></div>
        {rows.length ? <div className="table-scroll"><table className="data-table">
          <caption className="sr-only">Desempenho de cada cliente no período</caption>
          <thead><tr><th scope="col">Cliente</th><th scope="col">Situação</th><th scope="col" className="numeric">Investimento</th><th scope="col" className="numeric">Resultados</th><th scope="col" className="numeric">Custo/resultado</th><th scope="col">Tendência</th></tr></thead>
          <tbody>{sorted.map(row => <tr key={row.id}>
            <th scope="row" style={{ fontWeight: 400 }}><Link href={clientHref(row.id)} className="client-cell"><span className="client-avatar blue">{row.name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><span style={{ minWidth: 0 }}><strong>{row.name}</strong><small>{row.linkedAccounts ? `${row.linkedAccounts} ${row.linkedAccounts === 1 ? "conta" : "contas"} Meta` : "Sem contas Meta"}</small></span></Link></th>
            <td><span className={`badge ${STATUS[row.status].tone}`}><span className="status-dot" />{STATUS[row.status].label}</span></td>
            <td className="numeric">{money(row.spend, row.currency)}</td>
            <td className="numeric">{integer(row.results)} {row.results != null && <span className="muted">{row.resultLabel}</span>}</td>
            <td className="numeric">{money(costPerResult(row.spend, row.results), row.currency)}</td>
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
      const current = costPerResult(row.spend, row.results), previous = costPerResult(row.previousSpend, row.previousResults);
      const value = change(current, previous);
      return `Custo por resultado subiu ${value == null ? "" : `${Math.round(value)}% `}em relação ao período anterior.`;
    }
    case "updating": return "A coleta do período ainda não terminou.";
    default: return "Não foi possível consultar os dados agora.";
  }
}
