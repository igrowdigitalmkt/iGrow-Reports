"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import type { PerformanceData } from "./hub-performance";
import "./lead-feed.css";

const PERIODS = [
  { key: "today", label: "Hoje" }, { key: "7d", label: "Últimos 7 dias" }, { key: "14d", label: "Últimos 14 dias" }, { key: "30d", label: "Últimos 30 dias" },
  { key: "month", label: "Esse mês" }, { key: "last-month", label: "Último mês" }, { key: "90d", label: "Últimos 90 dias" },
] as const;
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const money = (value: number | null, currency: string | null) => value == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency ?? "BRL" }).format(value);

/** Aba Desempenho: leads por campanha, quantos avançaram no funil e o custo por lead (investimento confirmado ÷ leads). */
export function LeadsPerformance({ clientId }: { clientId: string }) {
  const [period, setPeriod] = useState<string>("30d");
  const [data, setData] = useState<PerformanceData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/leads/clients/${clientId}?desempenho=${period}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const next = await response.json() as PerformanceData;
        if (live) { setData(next); setFailed(false); }
      } catch { if (live) setFailed(true); }
    }, 0);
    return () => { live = false; clearTimeout(timer); };
  }, [clientId, period]);

  const ready = data && data.period === period;
  return <section className="lead-performance" aria-label="Desempenho por campanha">
    <div className="lead-filters">
      <Select className="compact-select lead-filter-select" inline aria-label="Período" value={period} onChange={event => { setPeriod(event.target.value); setData(null); }}>
        {PERIODS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </Select>
      {ready && <span className="lead-muted">{day(data.dateFrom)} a {day(data.dateTo)}</span>}
    </div>
    {failed && !ready && <p role="alert" className="lead-error">Não foi possível carregar o desempenho agora. Tente de novo em instantes.</p>}
    {!ready && !failed && <p className="lead-muted" role="status">Calculando…</p>}
    {ready && <>
      <div className="lead-kpis" role="group" aria-label="Resumo do período">
        <div><span>Leads</span><strong>{data.totals.leads}</strong></div>
        <div><span>Fechados</span><strong>{data.totals.won}</strong></div>
        <div><span>Investimento</span><strong>{money(data.totals.spend, data.totals.currency)}</strong></div>
        <div><span>Custo por lead</span><strong>{money(data.totals.costPerLead, data.totals.currency)}</strong></div>
      </div>
      {data.spendNote && <p className="lead-notice-line is-warn">{data.spendNote}</p>}
      {data.rows.length === 0 ? <div className="lead-empty"><strong>Nenhum lead neste período</strong><p>Escolha outro período ou aguarde os próximos cadastros.</p></div>
        : <div className="lead-table-wrap"><table className="lead-table">
          <thead><tr><th scope="col">Campanha</th><th scope="col">Leads</th><th scope="col">Contatados</th><th scope="col">Agendados</th><th scope="col">Fechados</th><th scope="col">Investimento</th><th scope="col">Custo por lead</th><th scope="col">Custo por fechado</th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.campaignId ?? "none"}>
            <th scope="row">{row.name}</th><td>{row.leads}</td><td>{row.inProgress}</td><td>{row.visits}</td><td>{row.won}</td>
            <td>{money(row.spend, row.currency)}</td><td>{money(row.costPerLead, row.currency)}</td><td>{money(row.costPerWon, row.currency)}</td></tr>)}</tbody>
        </table></div>}
      <p className="lead-foot">Custo por lead = investimento confirmado da campanha no período ÷ leads recebidos dela. Quando o investimento não está confirmado, o custo aparece como “—”, nunca como zero.</p>
    </>}
  </section>;
}
