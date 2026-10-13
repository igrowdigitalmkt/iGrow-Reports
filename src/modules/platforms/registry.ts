// Plataformas de anúncios que o iGrow apresenta nos relatórios (dashboard, PDF e mensagem de WhatsApp).
// O YouTube Ads é veiculado pela conta do Google Ads e aparece dentro da seção Google Ads.
export type PlatformKey = "meta" | "google" | "tiktok" | "linkedin";

export type PlatformInfo = {
  key: PlatformKey;
  label: string;
  // Texto do ícone na seção (a marca real entra quando o conector existir).
  mark: string;
  // Cor da seção no PDF (capa e destaques).
  color: string;
  // Conector pronto: só a Meta hoje. As demais aparecem como "Em breve".
  available: boolean;
};

export const PLATFORM_ORDER: PlatformKey[] = ["meta", "google", "tiktok", "linkedin"];

export const PLATFORM_INFO: Record<PlatformKey, PlatformInfo> = {
  meta: { key: "meta", label: "Meta Ads", mark: "∞", color: "#2563EB", available: true },
  google: { key: "google", label: "Google Ads", mark: "G", color: "#D93025", available: false },
  tiktok: { key: "tiktok", label: "TikTok Ads", mark: "♪", color: "#0F9D8A", available: false },
  linkedin: { key: "linkedin", label: "LinkedIn Ads", mark: "in", color: "#0A66C2", available: false },
};

export const platformLabel = (key: PlatformKey) => PLATFORM_INFO[key].label;
