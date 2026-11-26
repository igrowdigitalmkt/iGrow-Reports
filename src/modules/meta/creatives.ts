/** Regras puras dos criativos de uma campanha: só endereços da Meta/Instagram e só anúncios das contas do cliente. */

export type MetaCampaignAd = {
  id: string; name?: string; status?: string; effective_status?: string; account_id?: string; preview_shareable_link?: string;
  creative?: { id?: string; thumbnail_url?: string; image_url?: string; video_id?: string; effective_object_story_id?: string; instagram_permalink_url?: string };
};

/** Linha de resultado de um anúncio (Graph `insights` com `level=ad`). */
export type MetaAdResultRow = { ad_id?: string; spend?: string; impressions?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] };

export type AdResults = { spend: number; impressions: number; linkClicks: number; leads: number; costPerLead: number | null };

const toNumber = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; };

/** Gasto, cliques no link e cadastros (ação `lead`) de um anúncio; custo por cadastro só quando houve cadastro. */
export function toAdResults(row: MetaAdResultRow | undefined): AdResults | null {
  if (!row) return null;
  const spend = Math.round(toNumber(row.spend) * 100) / 100;
  const leads = toNumber(row.actions?.find(action => action.action_type === "lead")?.value);
  return { spend, impressions: toNumber(row.impressions), linkClicks: toNumber(row.inline_link_clicks), leads, costPerLead: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null };
}

export type CampaignCreative = {
  adId: string; name: string; status: string | null; type: "video" | "imagem";
  /** Resultado do anúncio no período consultado (null quando a Meta não devolveu entrega). */
  results: AdResults | null;
  /** Imagem do criativo (a melhor disponível) e miniatura. */
  imageUrl: string | null; thumbnailUrl: string | null;
  /** Link do post no Instagram ou no Facebook, e link de pré-visualização do anúncio. */
  postUrl: string | null; previewUrl: string | null;
};

const allowedHost = (host: string) => ["fbcdn.net", "facebook.com", "instagram.com", "fb.me", "cdninstagram.com"].some(domain => host === domain || host.endsWith(`.${domain}`));

/** Só https e só domínios da Meta/Instagram: qualquer outro endereço devolvido é descartado. */
export function safeMetaUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const url = new URL(value); return url.protocol === "https:" && allowedHost(url.hostname) ? url.href : null; } catch { return null; }
}

export function toCampaignCreative(ad: MetaCampaignAd, result?: MetaAdResultRow): CampaignCreative {
  const creative = ad.creative ?? {};
  const story = /^\d+_\d+$/.test(creative.effective_object_story_id ?? "") ? `https://www.facebook.com/${creative.effective_object_story_id}` : null;
  const thumbnailUrl = safeMetaUrl(creative.thumbnail_url);
  return {
    adId: ad.id, name: (ad.name ?? "").slice(0, 200), status: ad.effective_status?.trim().toUpperCase() || ad.status?.trim().toUpperCase() || null,
    type: creative.video_id ? "video" : "imagem", results: toAdResults(result), imageUrl: safeMetaUrl(creative.image_url) ?? thumbnailUrl, thumbnailUrl,
    postUrl: safeMetaUrl(creative.instagram_permalink_url) ?? story, previewUrl: safeMetaUrl(ad.preview_shareable_link),
  };
}

/** O anúncio pertence a uma das contas vinculadas ao cliente? (`account_id` da Graph vem sem o prefixo "act_"). */
export const adBelongsToAccounts = (ad: Pick<MetaCampaignAd, "account_id">, allowedExternalIds: string[]) =>
  !!ad.account_id && allowedExternalIds.map(id => id.replace(/^act_/, "")).includes(ad.account_id.replace(/^act_/, ""));
