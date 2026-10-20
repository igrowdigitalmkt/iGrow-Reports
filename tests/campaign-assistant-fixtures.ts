import { classifyDelivery } from "@/modules/campaigns/delivery-state";
import type { CampaignsData } from "@/modules/campaigns/load";
import type { CampaignRow } from "@/modules/campaigns/tree";

// Fixtures SOMENTE de teste. Nada disso chega à experiência autenticada.
export const IDS = {
  org: "9a1f6c2e-0000-4000-8000-000000000001", otherOrg: "9a1f6c2e-0000-4000-8000-000000000002",
  client: "7b2e0d11-0000-4000-8000-000000000001", otherOrgClient: "7b2e0d11-0000-4000-8000-000000000009",
  accA: "5c3d9a00-0000-4000-8000-00000000000a", accB: "5c3d9a00-0000-4000-8000-00000000000b", accOther: "5c3d9a00-0000-4000-8000-00000000000f",
};
export const LEAD = "result:provider:action:lead";
export const MSG = "result:provider:action:onsite_conversion.messaging_conversation_started_7d";
type Vals = Record<string, number | null>;
export const vals = (spend: number, results: Record<string, number> = {}): Vals => ({ spend, impressions: spend * 40, link_clicks: Math.round(spend / 2), cpc_link: 2, cpm: 25, "result:provider_known": 1, ...results });

export function row(level: CampaignRow["level"], id: string, name: string, parentId: string | null, accountId: string, values: Vals,
  status: string | null = "ACTIVE", extra: { delivering?: boolean | null; accountBlocked?: boolean } = {}): CampaignRow {
  return { key: `${level}:${id}`, id, level, name, parentId, campaignId: level === "campaign" ? id : null, accountId, accountName: accountId === IDS.accA ? "Conta A" : "Conta B", currency: "BRL", values,
    state: classifyDelivery({ configured: status, status, issues: false, accountBlocked: !!extra.accountBlocked }, extra.delivering ?? (status === "ACTIVE" ? true : null)) };
}
const metric = (key: string, label: string, unit: "currency" | "integer") => ({ key, label, unit, precision: unit === "currency" ? 2 : 0, desirable: "neutral" as const });

export function campaignsData(overrides: Partial<CampaignsData> = {}): CampaignsData {
  return {
    state: "ready", metricsState: "confirmed", message: null, period: "custom", dateFrom: "2026-09-19", dateTo: "2026-10-18", today: "2026-10-19",
    accounts: [{ id: IDS.accA, name: "Conta A", currency: "BRL" }, { id: IDS.accB, name: "Conta B", currency: "BRL" }], selectedAccountIds: [IDS.accA, IDS.accB],
    metrics: [metric("spend", "Investimento", "currency"), metric("impressions", "Impressões", "integer"), metric("link_clicks", "Cliques no link", "integer"), metric("cpc_link", "CPC (link)", "currency"), metric("cpm", "CPM", "currency")],
    rows: [
      row("campaign", "100", "Captação", null, IDS.accA, vals(300, { [LEAD]: 10, [MSG]: 30 })),
      row("adset", "200", "Formulário", "100", IDS.accA, vals(100, { [LEAD]: 10 })),
      row("adset", "201", "WhatsApp", "100", IDS.accA, vals(200, { [MSG]: 30 })),
      row("ad", "300", "Vídeo", "200", IDS.accA, vals(100, { [LEAD]: 10 })),
      row("campaign", "400", "Remarketing", null, IDS.accA, {}, "PAUSED", { accountBlocked: true }),
      // Mesmo ID e nome em outra conta: entidade diferente.
      row("campaign", "100", "Captação", null, IDS.accB, vals(50, { [LEAD]: 5 })),
    ],
    latestCollectedAt: "2026-10-19T12:00:00Z",
    live: { state: "ok", checkedAt: "2026-10-19T14:00:00Z", accountsRead: 2, accountsTotal: 2, cached: false }, warnings: [], ...overrides,
  };
}
