import type { CampaignRow } from "./tree";

/** Nível da entidade ↔ segmento da URL (português, estável). */
export const LEVEL_SLUGS = { campaign: "campanha", adset: "conjunto", ad: "anuncio" } as const satisfies Record<CampaignRow["level"], string>;
const LEVEL_BY_SLUG: Record<string, CampaignRow["level"]> = Object.fromEntries(Object.entries(LEVEL_SLUGS).map(([level, slug]) => [slug, level as CampaignRow["level"]]));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Identificadores externos da Meta são numéricos; aceita só um alfabeto seguro e curto para nunca montar consulta com texto livre. */
const EXTERNAL_ID = /^[0-9A-Za-z_-]{1,64}$/;

export const campaignsPath = (clientId: string) => `/clientes/${clientId}/campanhas`;

/**
 * Endereço da página de uma entidade: cliente (rota) + plataforma + conta de anúncios + nível + identificador externo.
 * Nunca usa o nome; contas diferentes com o mesmo identificador (ou nome) são endereços diferentes.
 */
export const entityPath = (clientId: string, entity: { accountId: string; level: CampaignRow["level"]; id: string }) =>
  `${campaignsPath(clientId)}/meta/${entity.accountId}/${LEVEL_SLUGS[entity.level]}/${encodeURIComponent(entity.id)}`;

export type EntityRoute = { platform: "meta"; accountId: string; level: CampaignRow["level"]; entityId: string };

/** Valida os segmentos dinâmicos; qualquer desvio é `null` (a página responde "não encontrado", nunca escolhe outra entidade). */
export function parseEntityRoute(params: { platform?: string; accountId?: string; level?: string; entityId?: string }): EntityRoute | null {
  if (params.platform !== "meta") return null;
  const level = params.level ? LEVEL_BY_SLUG[params.level] : undefined;
  let entityId: string;
  try { entityId = decodeURIComponent(params.entityId ?? ""); } catch { return null; }
  if (!level || !params.accountId || !UUID.test(params.accountId) || !EXTERNAL_ID.test(entityId)) return null;
  return { platform: "meta", accountId: params.accountId, level, entityId };
}

/** Período da tela (a mesma leitura vale ao abrir e voltar dos detalhes). */
export function periodSearch(period: { period: string; dateFrom: string; dateTo: string }): string {
  const params = new URLSearchParams({ periodo: period.period });
  if (period.period === "custom") { params.set("from", period.dateFrom); params.set("to", period.dateTo); }
  return `?${params.toString()}`;
}
