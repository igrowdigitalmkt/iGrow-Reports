import type { CollectionEntityMetadata,EntityLevel } from "../integrations/data-contract";
import type { MetaInsight } from "./client";

function numericId(value: unknown): string {
  if (typeof value!=="string" || !/^\d+$/.test(value)) throw new Error("invalid entity hierarchy");
  return value;
}
function entityName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value!=="string" || value.length>500) throw new Error("invalid entity name");
  return value.replace(/\p{Cc}/gu," ").trim() || null;
}

export function metaWorkerEntity(row: MetaInsight,level: EntityLevel): CollectionEntityMetadata {
  const account = `act_${numericId(row.account_id)}`;
  if (level==="account") return { name: entityName(row.account_name),parentId: null,campaignId: null,adsetId: null };
  const campaignId = numericId(row.campaign_id);
  if (level==="campaign") return { name: entityName(row.campaign_name),parentId: account,campaignId,adsetId: null };
  const adsetId = numericId(row.adset_id);
  if (adsetId===campaignId) throw new Error("invalid entity hierarchy");
  if (level==="adset") return { name: entityName(row.adset_name),parentId: campaignId,campaignId,adsetId };
  const adId = numericId(row.ad_id);
  if (adId===adsetId || adId===campaignId) throw new Error("invalid entity hierarchy");
  return { name: entityName(row.ad_name),parentId: adsetId,campaignId,adsetId };
}
