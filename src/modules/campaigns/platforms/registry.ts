/**
 * Registro de capacidades por plataforma (somente o que já está comprovado em `docs/CAMPANHAS_V1_CAPACIDADES_PLATAFORMAS.md`).
 * Cada plataforma declara a SUA hierarquia, com os nomes reais dos níveis; nada força IDs, campos ou ações da Meta nas demais.
 * `status: "operational"` só existe quando há leitura (e, se declarado, escrita) implementada e verificada neste repositório.
 */
export type PlatformId = "meta" | "google" | "tiktok" | "linkedin";
export type PlatformLevel = {
  /** Chave estável usada na URL (`?aba=`) e nas seleções. */
  key: string;
  /** Nome do nível na plataforma, no plural, como a aba é exibida. */
  label: string;
  singular: string;
  /** Nível pai direto (null no topo). */
  parent: string | null;
};
export type PlatformStructure = {
  /** Estrutura de navegação (Google tem uma por tipo de campanha). */
  id: string;
  label: string;
  levels: PlatformLevel[];
  /** Aviso estrutural para a tela (ex.: Performance Max não tem anúncios criados manualmente). */
  note?: string;
};
export type PlatformDefinition = {
  id: PlatformId;
  label: string;
  /** "operational": dados e navegação reais; "planned": só a estrutura está documentada, sem integração com dados. */
  status: "operational" | "planned";
  /** Escrita implementada e homologada neste repositório. */
  write: "partial" | "none";
  structures: PlatformStructure[];
  /** Origem documentada (consulta em 20/10/2026). */
  docs: string;
};

const trio = (a: string, b: string, c: string, ap: string, bp: string, cp: string): PlatformLevel[] => [
  { key: "campaign", label: ap, singular: a, parent: null },
  { key: "group", label: bp, singular: b, parent: "campaign" },
  { key: "item", label: cp, singular: c, parent: "group" },
];

export const PLATFORMS: Record<PlatformId, PlatformDefinition> = {
  meta: {
    id: "meta", label: "Meta Ads", status: "operational", write: "partial",
    docs: "https://developers.facebook.com/docs/marketing-api/campaign-structure",
    structures: [{ id: "default", label: "Campanha › Conjunto de anúncios › Anúncio", levels: [
      { key: "campaign", label: "Campanhas", singular: "Campanha", parent: null },
      { key: "adset", label: "Conjuntos de anúncios", singular: "Conjunto de anúncios", parent: "campaign" },
      { key: "ad", label: "Anúncios", singular: "Anúncio", parent: "adset" },
    ] }],
  },
  google: {
    id: "google", label: "Google Ads", status: "planned", write: "none",
    docs: "https://developers.google.com/google-ads/api/docs/concepts/api-structure",
    structures: [
      { id: "standard", label: "Search, Display e Shopping: Campanha › Grupo de anúncios › Anúncio", levels: trio("Campanha", "Grupo de anúncios", "Anúncio", "Campanhas", "Grupos de anúncios", "Anúncios") },
      { id: "performance_max", label: "Performance Max: Campanha › Grupo de recursos › Recursos", levels: trio("Campanha", "Grupo de recursos", "Recurso", "Campanhas", "Grupos de recursos", "Recursos"),
        note: "Performance Max não usa grupos de anúncios nem anúncios criados manualmente: os anúncios são montados pelo Google a partir dos recursos do grupo." },
    ],
  },
  tiktok: {
    id: "tiktok", label: "TikTok Ads", status: "planned", write: "none",
    docs: "https://business-api.tiktok.com/portal/docs",
    structures: [{ id: "default", label: "Campanha › Grupo de anúncios › Anúncio", levels: trio("Campanha", "Grupo de anúncios", "Anúncio", "Campanhas", "Grupos de anúncios", "Anúncios") }],
  },
  linkedin: {
    id: "linkedin", label: "LinkedIn Ads", status: "planned", write: "none",
    docs: "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns",
    structures: [{ id: "default", label: "Grupo de campanhas › Campanha › Criativo", levels: trio("Grupo de campanhas", "Campanha", "Criativo", "Grupos de campanhas", "Campanhas", "Criativos"),
      note: "O LinkedIn não tem conjunto de anúncios: o orçamento e a segmentação ficam na campanha, e o grupo de campanhas é o nível superior." }],
  },
};

/** Estrutura de navegação de uma plataforma (a primeira quando não houver escolha). */
export function structureOf(platform: PlatformId, structureId?: string): PlatformStructure {
  const definition = PLATFORMS[platform];
  return definition.structures.find(item => item.id === structureId) ?? definition.structures[0]!;
}

/** Só a Meta tem dados e navegação reais hoje; as demais plataformas não podem aparecer como integradas. */
export const operationalPlatforms = () => Object.values(PLATFORMS).filter(item => item.status === "operational");
