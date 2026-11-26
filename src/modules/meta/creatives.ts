/** Regras puras dos criativos de uma campanha: só endereços da Meta/Instagram e só anúncios das contas do cliente. */

export type MetaCampaignAd = {
  id: string; name?: string; status?: string; effective_status?: string; account_id?: string; preview_shareable_link?: string;
  creative?: { id?: string; thumbnail_url?: string; image_url?: string; video_id?: string; effective_object_story_id?: string; instagram_permalink_url?: string };
};

export type CampaignCreative = {
  adId: string; name: string; status: string | null; type: "video" | "imagem";
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

export function toCampaignCreative(ad: MetaCampaignAd): CampaignCreative {
  const creative = ad.creative ?? {};
  const story = /^\d+_\d+$/.test(creative.effective_object_story_id ?? "") ? `https://www.facebook.com/${creative.effective_object_story_id}` : null;
  const thumbnailUrl = safeMetaUrl(creative.thumbnail_url);
  return {
    adId: ad.id, name: (ad.name ?? "").slice(0, 200), status: ad.effective_status?.trim().toUpperCase() || ad.status?.trim().toUpperCase() || null,
    type: creative.video_id ? "video" : "imagem", imageUrl: safeMetaUrl(creative.image_url) ?? thumbnailUrl, thumbnailUrl,
    postUrl: safeMetaUrl(creative.instagram_permalink_url) ?? story, previewUrl: safeMetaUrl(ad.preview_shareable_link),
  };
}

/** O anúncio pertence a uma das contas vinculadas ao cliente? (`account_id` da Graph vem sem o prefixo "act_"). */
export const adBelongsToAccounts = (ad: Pick<MetaCampaignAd, "account_id">, allowedExternalIds: string[]) =>
  !!ad.account_id && allowedExternalIds.map(id => id.replace(/^act_/, "")).includes(ad.account_id.replace(/^act_/, ""));
