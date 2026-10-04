import { metaDeliveryStatus, metaHasDeliveryIssues, type MetaAd, type MetaAdSet, type MetaCampaign } from "./client";

// Meta keeps ACTIVE on completed boosts. Delivery also requires a current
// ad set schedule and a confirmed active ad, all from the same live account.
export function liveDeliveryStatuses(campaigns: MetaCampaign[], adsets: MetaAdSet[], ads: MetaAd[], now = Date.now()) {
  const statuses: Record<string, string> = {};
  const campaignById = new Map(campaigns.map(c => [c.id, c]));
  const setById = new Map(adsets.map(set => [set.id, set]));
  const activeSets = new Set(adsets.filter(set => {
    const start = Date.parse(set.start_time ?? "");
    const end = set.end_time == null ? Infinity : Date.parse(set.end_time);
    return metaDeliveryStatus(set) === "ACTIVE" && !metaHasDeliveryIssues(set) && Number.isFinite(start) && start <= now && end > now
      && metaDeliveryStatus(campaignById.get(set.campaign_id ?? "") ?? {}) === "ACTIVE"
      && !metaHasDeliveryIssues(campaignById.get(set.campaign_id ?? "") ?? {});
  }).map(set => set.id));
  const deliveringSets = new Set(ads.filter(ad => metaDeliveryStatus(ad) === "ACTIVE" && !metaHasDeliveryIssues(ad)
    && activeSets.has(ad.adset_id ?? "")
    && setById.get(ad.adset_id ?? "")?.campaign_id === ad.campaign_id).map(ad => ad.adset_id));
  for (const campaign of campaigns) statuses[`campaign:${campaign.id}`] = metaDeliveryStatus(campaign) === "ACTIVE" && !metaHasDeliveryIssues(campaign)
    ? adsets.some(set => set.campaign_id === campaign.id && deliveringSets.has(set.id)) ? "ACTIVE" : "INACTIVE"
    : metaHasDeliveryIssues(campaign) ? "INACTIVE" : metaDeliveryStatus(campaign) ?? "UNKNOWN";
  for (const set of adsets) statuses[`adset:${set.id}`] = deliveringSets.has(set.id) ? "ACTIVE" : "INACTIVE";
  for (const ad of ads) statuses[`ad:${ad.id}`] = metaDeliveryStatus(ad) === "ACTIVE" && !metaHasDeliveryIssues(ad) && deliveringSets.has(ad.adset_id)
    && setById.get(ad.adset_id ?? "")?.campaign_id === ad.campaign_id
    ? "ACTIVE" : "INACTIVE";
  return statuses;
}
