"use client";

import { useMemo } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleCheck, Target } from "lucide-react";
import type { ClientAccountBilling } from "@/modules/meta/server";
import { PortfolioSpendChart } from "@/modules/operations/portfolio-chart";
import { PlatformLogo } from "@/modules/platforms/platform-logo";
import { BillingSummary } from "./billing-section";
import { buildClientOverview, type OverviewGoogleSection, type OverviewResult } from "./client-overview";
import type { AnalyticsDashboardData } from "./analytics-types";

type Props = {
  clientId: string;
  data: AnalyticsDashboardData;
  googleSections: OverviewGoogleSection[];
  googleFailures: Array<{ name: string; message: string }>;
  /** Texto "dd/mm hh:mm" da ultima atualizacao dos dados (ja formatado no fuso da conta). */
  latest: string;
  dailySpend: Record<string, number>;
  demoBilling?: ClientAccountBilling[];
};

const integer = (value: number | null) => (value == null ? "—" : Math.round(value).toLocaleString("pt-BR"));
const money = (value: number | null, currency: string | null) => (value == null || !currency ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value));
const change = (current: number | null, previous: number | null) => (current == null || previous == null || previous === 0 ? null : (current - previous) / previous * 100);

function Delta({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="delta">—</span>;
  return <span className={`delta ${Math.abs(value) < .05 ? "" : value > 0 ? "is-good" : "is-bad"}`}>
    {value > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>;
}

function Sparkline({ values, width = 88, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2 || values.every(value => value === 0)) return <span className="muted">—</span>;
  const max = Math.max(...values), min = Math.min(...values, 0), pad = 3;
  const points = values.map((value, index) => [pad + index * (width - pad * 2) / (values.length - 1), pad + (height - pad * 2) * (1 - (value - min) / (max - min || 1))]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x!.toFixed(1)} ${y!.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1]!;
  return <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <path d={`${line} L${lastX!.toFixed(1)} ${height} L${pad} ${height} Z`} className="sparkline-area" />
    <path d={line} className="sparkline-line" /><circle cx={lastX} cy={lastY} r="2.4" className="sparkline-dot" /></svg>;
}

function Results({ results, currency }: { results: OverviewResult[]; currency: string | null }) {
  if (!results.length) return <span className="muted">Sem resultados</span>;
  const single = results.length === 1 ? results[0]! : null;
  const rest = results.slice(3);
  return <div className="result-list" title={results.map(result => `${integer(result.value)} ${result.label}`).join(" · ")}>
    {results.slice(0, 3).map(result => <span key={result.key}><strong>{integer(result.value)}</strong> {result.label}</span>)}
    {rest.length > 0 && <span className="muted">+{rest.length} {rest.length === 1 ? "tipo" : "tipos"}</span>}
    {single?.cost != null && <span className="muted">{money(single.cost, currency)} por resultado</span>}
  </div>;
}

/**
 * Visão geral do cliente em todas as plataformas: o estado do cliente de relance (contas, investimento, resultados, alertas,
 * saldo e pagamentos) e o que mais pesa nele. A análise detalhada de campanhas continua no Dashboard e em Campanhas.
 */
export function ClientSummary({ clientId, data, googleSections, googleFailures, latest, dailySpend, demoBilling }: Props) {
  const complete = data.coverage.status === "complete";
  const overview = useMemo(() => buildClientOverview(data, googleSections), [data, googleSections]);
  const alerts = [...data.warnings, ...googleFailures.map(failure => `Google Ads: não foi possível ler a conta ${failure.name} agora. ${failure.message}`)];
  // Média diária por conta (para a duração do saldo): Google entra pelo gasto do período dividido pelos dias.
  const dailyByAccount = useMemo(() => ({
    ...dailySpend,
    ...Object.fromEntries(googleSections.map(section => [section.id, (section.data.summary.spend ?? 0) / Math.max(1, section.data.daily.length)])),
  }), [dailySpend, googleSections]);

  return <div className="client-summary-view">
    <section className="client-summary-tiles" aria-label="Resumo">
      <article>
        <span>Contas de anúncios</span>
        <div className="summary-logos" role="img" aria-label={`${overview.platformCounts.meta} ${overview.platformCounts.meta === 1 ? "conta" : "contas"} Meta Ads e ${overview.platformCounts.google} ${overview.platformCounts.google === 1 ? "conta" : "contas"} Google Ads`}>
          {Array.from({ length: overview.platformCounts.meta }, (_, index) => <PlatformLogo key={`m${index}`} platform="meta" size={22} />)}
          {Array.from({ length: overview.platformCounts.google }, (_, index) => <PlatformLogo key={`g${index}`} platform="google" size={26} />)}
          {!overview.platformCounts.meta && !overview.platformCounts.google && <strong>Nenhuma</strong>}
        </div>
      </article>
      <article><span>Dados do período</span><strong>{complete ? "Completos" : `${data.coverage.coveredDays} de ${data.coverage.totalDays} dias`}</strong></article>
      <article><span>Última atualização</span><strong>{latest}</strong></article>
      <article className="summary-alerts-tile">
        <span>Alertas de qualidade</span>
        {alerts.length
          ? <details className="summary-alerts">
            <summary><strong>{alerts.length} {alerts.length === 1 ? "alerta" : "alertas"}</strong><small>ver detalhes</small></summary>
            <div role="region" aria-label="Alertas de qualidade">{alerts.map(alert => <p key={alert}><AlertTriangle size={14} />{alert}</p>)}</div>
          </details>
          : <strong>Nenhum</strong>}
      </article>
    </section>

    <section className="cs-kpis" aria-label="Investimento e resultados">
      <section className="panel metric-card">
        <div className="metric-label"><span>Investimento no período</span></div>
        <strong className="metric-value">{money(overview.spend, overview.currency)}</strong>
        <div className="metric-foot">{overview.spend != null && overview.previousSpend != null
          ? <><Delta value={change(overview.spend, overview.previousSpend)} /><span>vs. período anterior</span></>
          : <span>{overview.currency ? "comparação indisponível" : "contas com moedas diferentes: veja o valor de cada conta abaixo"}</span>}</div>
      </section>
      <section className="panel metric-card cs-results">
        <div className="metric-label"><span>Resultados</span><Target size={15} className="muted" /></div>
        {overview.results.length
          ? <ul>{overview.results.slice(0, 5).map(result => <li key={result.key}><span>{result.label}</span><strong>{integer(result.value)}</strong></li>)}</ul>
          : <p className="muted text-sm">Nenhum resultado no período.</p>}
        {overview.results.length > 5 && <div className="metric-foot"><span>+{overview.results.length - 5} tipos no Dashboard</span></div>}
      </section>
      <section className="panel cs-chart">
        <div className="panel-heading"><div><h2>Investimento por dia</h2><p>Meta Ads e Google Ads somados{overview.currency ? "" : " · moedas diferentes, gráfico indisponível"}</p></div></div>
        <div className="cs-chart-body">{overview.currency && overview.days.length
          ? <PortfolioSpendChart days={overview.days} spend={overview.trend} previous={overview.previousTrend} currency={overview.currency} />
          : <div className="muted text-sm">Sem série diária para exibir.</div>}</div>
      </section>
    </section>

    <BillingSummary clientId={clientId} dailySpend={dailyByAccount} accountIds={data.selectedAccountIds} demoAccounts={demoBilling} />

    <section className="panel cs-table" aria-label="Contas de anúncios">
      <div className="panel-heading"><div><h2>Contas de anúncios</h2><p>Desempenho de cada conta no período</p></div></div>
      {overview.accounts.length ? <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">Investimento e resultados de cada conta de anúncios</caption>
        <thead><tr><th scope="col">Conta</th><th scope="col" className="numeric">Investimento</th><th scope="col">Resultados no período</th><th scope="col">Tendência</th></tr></thead>
        <tbody>{overview.accounts.map(account => <tr key={`${account.platform}:${account.id}`}>
          <th scope="row" style={{ fontWeight: 400 }}><span className="cs-account"><PlatformLogo platform={account.platform} size={account.platform === "meta" ? 14 : 18} /><span><strong>{account.name}</strong><small>{account.platform === "meta" ? "Meta Ads" : "Google Ads"} · {account.detail}</small></span></span></th>
          <td className="numeric">{money(account.spend, account.currency)}</td>
          <td>{account.spend == null ? <span className="muted">—</span> : <Results results={account.results} currency={account.currency} />}</td>
          <td><Sparkline values={account.trend} /></td>
        </tr>)}</tbody>
      </table></div> : <p className="muted text-sm" style={{ padding: "0 18px 16px" }}>Nenhuma conta de anúncios vinculada.</p>}
    </section>

    {overview.campaigns.length > 0 && <section className="panel cs-table" aria-label="Principais campanhas">
      <div className="panel-heading"><div><h2>Principais campanhas</h2><p>As que mais investiram no período, nas duas plataformas</p></div></div>
      <div className="table-scroll"><table className="data-table">
        <caption className="sr-only">Campanhas com maior investimento</caption>
        <thead><tr><th scope="col">Campanha</th><th scope="col" className="numeric">Investimento</th><th scope="col">Resultado</th></tr></thead>
        <tbody>{overview.campaigns.map(campaign => <tr key={`${campaign.platform}:${campaign.accountId}:${campaign.id}`}>
          <th scope="row" style={{ fontWeight: 400 }}><span className="cs-account"><PlatformLogo platform={campaign.platform} size={campaign.platform === "meta" ? 14 : 18} /><span><strong>{campaign.name}</strong><small>{campaign.accountName}</small></span></span></th>
          <td className="numeric">{money(campaign.spend, campaign.currency)}</td>
          <td>{campaign.result ? <span><strong>{integer(campaign.result.value)}</strong> {campaign.result.label.toLowerCase()}{campaign.result.cost != null ? ` · ${money(campaign.result.cost, campaign.currency)} cada` : ""}</span> : <span className="muted">Sem resultado</span>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {!alerts.length && <p className="cs-ok"><CircleCheck size={14} />Nenhum alerta de qualidade no período.</p>}
  </div>;
}
