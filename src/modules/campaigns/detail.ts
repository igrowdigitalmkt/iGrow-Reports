import type { CampaignsData } from "./load";
import type { EntityRoute } from "./routes";
import { childrenOf, type CampaignRow } from "./tree";

export const sameEntity = (row: CampaignRow, ref: { accountId: string; level: CampaignRow["level"]; id: string }) =>
  row.accountId === ref.accountId && row.level === ref.level && row.id === ref.id;

/** Entidade pedida pela rota: conta + nível + identificador externo. Nunca por nome e nunca "a mais parecida". */
export const findEntity = (rows: CampaignRow[], route: Pick<EntityRoute, "accountId" | "level" | "entityId">) =>
  rows.find(row => sameEntity(row, { accountId: route.accountId, level: route.level, id: route.entityId })) ?? null;

/** Ancestrais (conjunto e campanha) na ordem do mais próximo ao mais distante; pais ausentes interrompem a cadeia. */
export function ancestorsOf(row: CampaignRow, rows: CampaignRow[]): CampaignRow[] {
  const chain: CampaignRow[] = [];
  for (let current = row; current.parentId;) {
    const level = current.level === "ad" ? "adset" : "campaign";
    const parent = rows.find(item => item.accountId === current.accountId && item.level === level && item.id === current.parentId);
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/** Entidade, ancestrais e todos os descendentes: o suficiente para a tela de detalhes, o custo atribuído e o contexto do assistente. */
export function subtreeWithAncestors(row: CampaignRow, rows: CampaignRow[]): CampaignRow[] {
  const keep = new Map<string, CampaignRow>();
  const add = (item: CampaignRow) => keep.set(`${item.accountId}:${item.key}`, item);
  const walk = (item: CampaignRow) => { add(item); for (const child of childrenOf(item, rows)) walk(child); };
  walk(row);
  for (const ancestor of ancestorsOf(row, rows)) add(ancestor);
  return rows.filter(item => keep.has(`${item.accountId}:${item.key}`));
}

/** Dados enxutos para a página de uma entidade (menos bytes para o navegador); o restante da conta não é enviado. */
export const trimForEntity = (data: CampaignsData, row: CampaignRow): CampaignsData => ({ ...data, rows: subtreeWithAncestors(row, data.rows) });
