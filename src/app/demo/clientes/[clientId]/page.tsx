import type { Metadata } from "next";
import { ClientAnalyticsDashboard } from "@/modules/client-portal/analytics-dashboard";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";

export const metadata: Metadata = { title: "Painel do cliente · demonstração" };

export default function DemoClientPage() {
  const data = getDemoClientAnalytics();
  const entities: AnalyticsEntity[] = data.campaigns.map(campaign => ({
    key: `campaign:${campaign.id}`, id: campaign.id, level: "campaign", name: campaign.name, parentId: null, campaignId: campaign.id,
    accountId: campaign.accountId, accountName: campaign.accountName, currency: campaign.currency, values: campaign.values,
    effectiveStatus: "ACTIVE", thumbnailUrl: null,
  }));
  return <ClientAnalyticsDashboard demo data={data} entities={entities} workspaceName="iGrow Digital" clientName="Escola Horizonte"
    clientId="00000000-0000-4000-8000-000000000001" workspaceId="demo" canCollect={false} canManageReports={false} reports={[]} preferenceKey="demo:escola-horizonte" demoBilling={[
      { accountId: "a1", name: "Escola Horizonte · Principal", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: true, fundingLabel: "Saldo disponível (R$1.274,82 BRL)", availableBalance: 1274.82, amountSpent: 637.07, spendCap: 1757, balanceDue: null },
      { accountId: "a2", name: "Escola Horizonte · Unidade 2", currency: "BRL", delivering: false, statusLabel: "Pagamento pendente", prepaid: false, fundingLabel: "VISA *7549", availableBalance: null, amountSpent: 16203.75, spendCap: null, balanceDue: 1234.03 },
      { accountId: "a3", name: "Escola Horizonte (Reserva)", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: true, fundingLabel: "Saldo disponível (R$0,00 BRL)", availableBalance: 0, amountSpent: 0, spendCap: null, balanceDue: null },
    ]} />;
}
