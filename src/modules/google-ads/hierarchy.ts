import { classifyDelivery, type DeliveryState } from "@/modules/campaigns/delivery-state";
import type { CampaignRow } from "@/modules/campaigns/tree";
import { googleEntityValues, type GoogleAccount } from "./normalize";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => (value && typeof value === "object" && !Array.isArray(value) ? value as Row : {});
const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

export type GoogleHierarchyRows = {
  campaigns: Row[]; campaignList?: Row[]; adGroups: Row[]; adGroupList?: Row[]; ads: Row[]; adList?: Row[];
};

/** Estado efetivo no vocabulário já usado pela tela de Campanhas: o do próprio item ou o do pai que o impede de veicular. */
function effectiveCode(own: string, parents: Array<{ status: string; code: "CAMPAIGN_PAUSED" | "ADSET_PAUSED" }>) {
  if (own !== "ENABLED") return own === "PAUSED" ? "PAUSED" : own || null;
  const blocker = parents.find(parent => parent.status !== "ENABLED");
  return blocker ? blocker.code : "ACTIVE";
}

function stateOf(status: string, parents: Array<{ status: string; code: "CAMPAIGN_PAUSED" | "ADSET_PAUSED" }>, createdAt: string | null): DeliveryState {
  const configured = status === "ENABLED" ? "ACTIVE" : status === "PAUSED" ? "PAUSED" : status || null;
  const state = classifyDelivery({ configured, status: effectiveCode(status, parents), issues: false, accountBlocked: false, createdAt }, null);
  // No Google o nível intermediário é "grupo de anúncios", não "conjunto".
  return state.effective?.code === "ADSET_PAUSED" ? { ...state, label: "Grupo de anúncios pausado" } : state;
}

/** Une as linhas com métricas do período e a lista completa (itens sem atividade no período entram com zero confirmado). */
function merge(withMetrics: Row[], list: Row[] | undefined, idOf: (row: Row) => string) {
  const seen = new Set(withMetrics.map(idOf));
  return [...withMetrics, ...(list ?? []).filter(row => { const id = idOf(row); return id && !seen.has(id); })]
    .filter(row => idOf(row))
    .map(row => ({ row }));
}

const adName = (ad: Row, fallback: string) => {
  const named = text(ad.name).trim();
  if (named) return named;
  const headlines = object(ad.responsiveSearchAd).headlines;
  const first = Array.isArray(headlines) ? text(object(headlines[0]).text).trim() : "";
  return first || `Anúncio ${fallback}`;
};

/**
 * Campanhas, grupos de anúncios e anúncios de UMA conta do Google Ads no mesmo formato das linhas de Campanhas da Meta (`CampaignRow`),
 * para a tabela de três níveis funcionar igual nas duas plataformas. Só leitura.
 */
export function buildGoogleRows(account: GoogleAccount, rows: GoogleHierarchyRows): CampaignRow[] {
  const base = { accountId: account.id, accountName: account.name, currency: account.currency };
  const campaigns = merge(rows.campaigns, rows.campaignList, row => text(object(row.campaign).id));
  const campaignStatus = new Map(campaigns.map(({ row }) => [text(object(row.campaign).id), text(object(row.campaign).status)]));
  const groups = merge(rows.adGroups, rows.adGroupList, row => text(object(row.adGroup).id));
  const groupInfo = new Map(groups.map(({ row }) => [text(object(row.adGroup).id), { status: text(object(row.adGroup).status), campaign: text(object(row.campaign).id) }]));
  const ads = merge(rows.ads, rows.adList, row => text(object(object(row.adGroupAd).ad).id));

  const out: CampaignRow[] = [];
  for (const { row } of campaigns) {
    const campaign = object(row.campaign);
    const id = text(campaign.id), status = text(campaign.status);
    const start = text(campaign.startDate);
    out.push({
      ...base, key: `campaign:${id}`, id, level: "campaign", name: text(campaign.name) || "Campanha", parentId: null, campaignId: id,
      values: googleEntityValues(object(row.metrics), campaign.advertisingChannelType === "VIDEO"), effectiveStatus: null,
      state: stateOf(status, [], /^\d{4}-\d{2}-\d{2}$/.test(start) ? `${start}T00:00:00Z` : null),
    });
  }
  for (const { row } of groups) {
    const group = object(row.adGroup), campaign = object(row.campaign);
    const id = text(group.id), campaignId = text(campaign.id);
    out.push({
      ...base, key: `adset:${id}`, id, level: "adset", name: text(group.name) || "Grupo de anúncios", parentId: campaignId, campaignId,
      values: googleEntityValues(object(row.metrics), campaign.advertisingChannelType === "VIDEO"), effectiveStatus: null,
      state: stateOf(text(group.status), [{ status: campaignStatus.get(campaignId) ?? "ENABLED", code: "CAMPAIGN_PAUSED" }], null),
    });
  }
  for (const { row } of ads) {
    const groupAd = object(row.adGroupAd), ad = object(groupAd.ad);
    const id = text(ad.id), groupId = text(object(row.adGroup).id), campaignId = text(object(row.campaign).id);
    const parent = groupInfo.get(groupId);
    out.push({
      ...base, key: `ad:${id}`, id, level: "ad", name: adName(ad, id), parentId: groupId, campaignId: campaignId || parent?.campaign || null,
      values: googleEntityValues(object(row.metrics), object(row.campaign).advertisingChannelType === "VIDEO"), effectiveStatus: null,
      state: stateOf(text(groupAd.status), [
        { status: campaignStatus.get(campaignId || parent?.campaign || "") ?? "ENABLED", code: "CAMPAIGN_PAUSED" },
        { status: parent?.status ?? "ENABLED", code: "ADSET_PAUSED" },
      ], null),
    });
  }
  return out;
}
