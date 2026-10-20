import type { AssistantContext, AssistantEntityLevel, AssistantEntityRef, AssistantScope, AssistantSelection } from "./contracts";

type Row = { key: string; id: string; level: AssistantEntityLevel; name: string; parentId: string | null; accountId: string };
export type ContextData = { rows: Row[]; accounts: { id: string; name: string }[]; selectedAccountIds: string[]; dateFrom: string; dateTo: string; /** Ausente = confirmadas. */ metricsState?: "confirmed" | "pending" };

const sameScope = (a: AssistantScope, b: AssistantScope) => a.organizationId === b.organizationId && a.clientId === b.clientId && a.platform === b.platform;

/**
 * Chave estável da identidade: organização, cliente, plataforma, CONJUNTO DE CONTAS, nível, ID e PERÍODO. Nunca usa o nome.
 * No contexto geral o conjunto é o das contas selecionadas (ordenado); na conta e na entidade é a conta. Conjuntos diferentes de contas
 * do mesmo cliente, ou períodos diferentes, são contextos e conversas diferentes.
 */
export function contextKey(scope: AssistantScope, level: string, period: { dateFrom: string; dateTo: string }, accountIds: string[], entityId?: string) {
  const accounts = [...accountIds].sort().join(",") || "-";
  return [scope.organizationId, scope.clientId, scope.platform, accounts, level, entityId ?? "-", `${period.dateFrom}..${period.dateTo}`].join("|");
}

export const generalSelection = (scope: AssistantScope): AssistantSelection => ({ scope, kind: "client" });

/**
 * Resolve a seleção contra os dados ATUAIS. Seleção de outro escopo (organização, cliente ou plataforma), de conta fora do filtro
 * ou de entidade que não existe mais volta ao contexto geral com `invalidated: true`; o assistente nunca fica preso ao que saiu do escopo.
 * Entidades de contas diferentes com o mesmo ID ou nome não se confundem: a busca usa conta + nível + ID.
 * O contexto geral considera exatamente as contas selecionadas na tabela (`accounts`).
 */
export function resolveContext(selection: AssistantSelection | null, scope: AssistantScope, data: ContextData): { context: AssistantContext; invalidated: boolean } {
  const period = { dateFrom: data.dateFrom, dateTo: data.dateTo };
  const selected = data.selectedAccountIds.flatMap(id => data.accounts.filter(account => account.id === id).map(account => ({ id: account.id, name: account.name })));
  const general = (invalidated: boolean) => ({ invalidated, context: { key: contextKey(scope, "client", period, selected.map(account => account.id)), scope, level: "client" as const, account: null, accounts: selected, entity: null, ancestors: [], period } });
  if (!selection || selection.kind === "client") return general(false);
  if (!sameScope(selection.scope, scope)) return general(true);
  const account = selected.find(item => item.id === selection.accountId);
  if (!account) return general(true);
  const base = { scope, account, accounts: [account], period };
  if (selection.kind === "account") return { invalidated: false, context: { ...base, key: contextKey(scope, "account", period, [account.id]), level: "account", entity: null, ancestors: [] } };
  const find = (level: AssistantEntityLevel, id: string) => data.rows.find(row => row.accountId === account.id && row.level === level && row.id === id);
  const row = find(selection.level, selection.entityId);
  if (!row) return general(true);
  const ref = (item: Row): AssistantEntityRef => ({ level: item.level, id: item.id, name: item.name });
  const ancestors: AssistantEntityRef[] = [];
  for (let parent = row; parent.parentId;) {
    const next = find(parent.level === "ad" ? "adset" : "campaign", parent.parentId);
    if (!next) break;
    ancestors.push(ref(next));
    parent = next;
  }
  return { invalidated: false, context: { ...base, key: contextKey(scope, row.level, period, [account.id], row.id), level: row.level, entity: ref(row), ancestors } };
}
