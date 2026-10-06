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
      { accountId: "a1", name: "Escola Horizonte · Principal", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: true, fundingLabel: "Saldo disponível (R$ 412,80 BRL)", availableBalance: 412.8, amountSpent: 48210.55, spendCap: null, balanceDue: null },
      { accountId: "a2", name: "Escola Horizonte · Unidade 2", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: false, fundingLabel: "Mastercard *4821", availableBalance: null, amountSpent: 9120.4, spendCap: 12000, balanceDue: 186.3 },
    ]} />;
}
