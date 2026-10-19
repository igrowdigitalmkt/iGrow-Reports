import type { ClientAccountBilling } from "@/modules/meta/server";
import { BillingSummary } from "./billing-section";
import type { AnalyticsDashboardData } from "./analytics-types";

type Props = {
  clientId: string;
  data: AnalyticsDashboardData;
  googleAccounts: Array<{ id: string; name: string }>;
  /** Texto "dd/mm hh:mm" da ultima atualizacao dos dados (ja formatado no fuso da conta). */
  latest: string;
  dailySpend: Record<string, number>;
  demoBilling?: ClientAccountBilling[];
};

/**
 * Visao geral do cliente: saldo, contas e um resumo de estado. NAO mostra indicadores de campanha
 * (investimento, resultados, graficos): tudo isso fica no Dashboard.
 */
export function ClientSummary({ clientId, data, googleAccounts, latest, dailySpend, demoBilling }: Props) {
  const complete = data.coverage.status === "complete";
  const accountsLabel = googleAccounts.length
    ? `${data.accounts.length} Meta · ${googleAccounts.length} Google` : String(data.accounts.length);
  return <div className="client-summary-view">
    <section className="client-summary-tiles" aria-label="Resumo">
      <article><span>Contas de anúncios</span><strong>{accountsLabel}</strong></article>
      <article><span>Dados do período</span><strong>{complete ? "Completos" : `${data.coverage.coveredDays} de ${data.coverage.totalDays} dias`}</strong></article>
      <article><span>Última atualização</span><strong>{latest}</strong></article>
      <article><span>Alertas de qualidade</span><strong>{data.warnings.length ? `${data.warnings.length} ${data.warnings.length === 1 ? "alerta" : "alertas"}` : "Nenhum"}</strong></article>
    </section>
    <BillingSummary clientId={clientId} dailySpend={dailySpend} accountIds={data.selectedAccountIds} demoAccounts={demoBilling} />
    <section className="client-summary" aria-label="Contas de anúncios">
      <h3>Contas de anúncios</h3>
      <ul>
        {data.accounts.map(account => <li key={account.id}><strong>{account.name}</strong>
          <span>Meta Ads · {account.externalId} · {account.currency} · {account.timezoneName}</span></li>)}
        {googleAccounts.map(account => <li key={account.id}><strong>{account.name}</strong><span>Google Ads</span></li>)}
      </ul>
    </section>
  </div>;
}
