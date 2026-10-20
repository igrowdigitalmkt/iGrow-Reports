import { DEFAULT_COLUMN_KEYS, type ColumnDef } from "./columns";

/**
 * Preferência LOCAL das colunas da tabela de Campanhas: só as chaves das colunas, na ordem escolhida (nenhuma métrica, valor ou dado do
 * cliente). Vinculada à organização e ao usuário. A versão invalida formatos antigos; chaves desconhecidas (por exemplo, um tipo de
 * resultado que não existe neste período) são ignoradas na leitura, mas não apagadas da preferência.
 */
const VERSION = 1;
const MAX_KEYS = 80;
const KEY_PATTERN = /^[A-Za-z0-9_:.-]{1,100}$/;

export const columnPreferenceKey = (preferenceKey: string) => `groow.campaigns.columns.v${VERSION}:${preferenceKey}`;

/** Lê e valida o texto salvo; qualquer formato inesperado devolve `null` (usa-se o padrão). */
export function parseColumnPreference(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.length || value.length > MAX_KEYS) return null;
    if (!value.every((item): item is string => typeof item === "string" && KEY_PATTERN.test(item))) return null;
    return [...new Set(value)];
  } catch { return null; }
}

export const serializeColumnPreference = (keys: string[]) => JSON.stringify([...new Set(keys)].slice(0, MAX_KEYS));

/** Colunas na ordem preferida, só as que existem no catálogo atual; se nenhuma sobrar, o padrão. */
export function applyColumnPreference(catalog: ColumnDef[], keys: string[]): ColumnDef[] {
  const byKey = new Map(catalog.map(column => [column.key, column] as const));
  const chosen = keys.flatMap(key => byKey.get(key) ?? []);
  if (chosen.length) return chosen;
  return DEFAULT_COLUMN_KEYS.flatMap(key => byKey.get(key) ?? []);
}

/** Move uma coluna (visível) uma posição; as chaves ocultas não mudam de lugar relativo. */
export function moveColumn(keys: string[], key: string, direction: -1 | 1): string[] {
  const from = keys.indexOf(key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= keys.length) return keys;
  const next = [...keys];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
