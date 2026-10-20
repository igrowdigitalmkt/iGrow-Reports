import type { CampaignRow } from "../tree";

/**
 * Seleção contextual entre os três níveis (Meta): campanhas filtram conjuntos, conjuntos filtram anúncios e, sem conjuntos selecionados,
 * as campanhas filtram os anúncios. Funções puras: a tela só guarda o resultado. A identidade de toda entidade é conta + nível + ID
 * externo, então contas diferentes com o mesmo ID nunca se misturam.
 */
export type NavLevel = CampaignRow["level"];
export type NavSelection = { campaign: string[]; adset: string[]; ad: string[] };
export const EMPTY_SELECTION: NavSelection = { campaign: [], adset: [], ad: [] };

type Ref = { accountId: string; level: NavLevel; id: string };
export const entityKey = (ref: Ref) => `${ref.accountId}|${ref.level}|${ref.id}`;
const campaignKeyOf = (row: CampaignRow): string | null => {
  const id = row.level === "campaign" ? row.id : row.level === "adset" ? row.campaignId ?? row.parentId : row.campaignId;
  return id ? `${row.accountId}|campaign|${id}` : null;
};
const adsetKeyOf = (row: CampaignRow): string | null => row.level === "ad" && row.parentId ? `${row.accountId}|adset|${row.parentId}` : null;

/**
 * Linhas do nível ativo dentro do escopo da seleção.
 * Conjuntos: das campanhas selecionadas (ou todos). Anúncios: dos conjuntos selecionados; senão das campanhas selecionadas; senão todos.
 * Seleção que não existe mais nos dados é ignorada (não influencia o escopo).
 */
export function scopeRows(level: NavLevel, rows: CampaignRow[], selection: NavSelection): CampaignRow[] {
  const own = rows.filter(row => row.level === level);
  if (level === "campaign") return own;
  const known = new Set(rows.map(entityKey));
  const campaigns = new Set(selection.campaign.filter(key => known.has(key)));
  if (level === "adset") return campaigns.size ? own.filter(row => { const key = campaignKeyOf(row); return !!key && campaigns.has(key); }) : own;
  const adsets = new Set(selection.adset.filter(key => known.has(key)));
  if (adsets.size) return own.filter(row => { const key = adsetKeyOf(row); return !!key && adsets.has(key); });
  return campaigns.size ? own.filter(row => { const key = campaignKeyOf(row); return !!key && campaigns.has(key); }) : own;
}

/**
 * Remove da seleção o que deixou de ser válido: entidades que não existem nos dados, conjuntos fora das campanhas selecionadas e anúncios
 * fora do escopo atual. Nada incompatível fica escondido influenciando outra aba.
 */
export function reconcileSelection(selection: NavSelection, rows: CampaignRow[]): NavSelection {
  const known = new Set(rows.map(entityKey));
  const campaign = selection.campaign.filter(key => known.has(key));
  const withCampaigns: NavSelection = { campaign, adset: selection.adset.filter(key => known.has(key)), ad: selection.ad.filter(key => known.has(key)) };
  const adsetScope = new Set(scopeRows("adset", rows, withCampaigns).map(entityKey));
  const adset = withCampaigns.adset.filter(key => adsetScope.has(key));
  const adScope = new Set(scopeRows("ad", rows, { campaign, adset, ad: [] }).map(entityKey));
  const ad = withCampaigns.ad.filter(key => adScope.has(key));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((key, index) => key === b[index]);
  return same(campaign, selection.campaign) && same(adset, selection.adset) && same(ad, selection.ad) ? selection : { campaign, adset, ad };
}

/** Marca ou desmarca entidades de UM nível e devolve a seleção já reconciliada. */
export function setSelected(selection: NavSelection, rows: CampaignRow[], level: NavLevel, keys: string[], on: boolean): NavSelection {
  const current = new Set(selection[level]);
  for (const key of keys) { if (on) current.add(key); else current.delete(key); }
  return reconcileSelection({ ...selection, [level]: [...current] }, rows);
}

export const clearSelection = (): NavSelection => EMPTY_SELECTION;
export const selectionCount = (selection: NavSelection) => selection.campaign.length + selection.adset.length + selection.ad.length;

/** Texto curto do escopo aplicado a um nível (para a tela explicar por que a lista está filtrada). */
export function scopeDescription(level: NavLevel, selection: NavSelection): string | null {
  if (level === "adset" && selection.campaign.length) return `Conjuntos de ${selection.campaign.length} ${selection.campaign.length === 1 ? "campanha selecionada" : "campanhas selecionadas"}`;
  if (level === "ad" && selection.adset.length) return `Anúncios de ${selection.adset.length} ${selection.adset.length === 1 ? "conjunto selecionado" : "conjuntos selecionados"}`;
  if (level === "ad" && selection.campaign.length) return `Anúncios de ${selection.campaign.length} ${selection.campaign.length === 1 ? "campanha selecionada" : "campanhas selecionadas"}`;
  return null;
}

/** Armazenamento da seleção (sessionStorage): só chaves de identidade, nunca métricas. Formato inesperado vira seleção vazia. */
const KEY_PATTERN = /^[0-9a-f-]{36}\|(campaign|adset|ad)\|[0-9A-Za-z_-]{1,64}$/;
const MAX_KEYS = 5000;
export function parseStoredSelection(raw: string | null): NavSelection {
  if (!raw) return EMPTY_SELECTION;
  try {
    const value = JSON.parse(raw) as Partial<Record<NavLevel, unknown>>;
    const clean = (list: unknown, level: NavLevel) => Array.isArray(list)
      ? [...new Set(list.filter((item): item is string => typeof item === "string" && KEY_PATTERN.test(item) && item.split("|")[1] === level))].slice(0, MAX_KEYS) : [];
    return { campaign: clean(value.campaign, "campaign"), adset: clean(value.adset, "adset"), ad: clean(value.ad, "ad") };
  } catch { return EMPTY_SELECTION; }
}
export const serializeSelection = (selection: NavSelection) => JSON.stringify(selection);
export const selectionStorageKey = (preferenceKey: string, clientId: string, platform: string) => `groow.campaigns.selection.v1:${preferenceKey}:${clientId}:${platform}`;
