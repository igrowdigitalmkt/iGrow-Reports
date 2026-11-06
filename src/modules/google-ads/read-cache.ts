import "server-only";

/**
 * Cache curto, na memória do servidor, das leituras do Google Ads que desenham o painel e as campanhas. Sem ele, cada abertura da tela
 * e cada atualização automática chamava a API do Google de novo (4 a 6 consultas por conta). O Google fecha os números do dia com
 * atraso, então alguns minutos de cache não mudam o que a pessoa vê.
 *
 * Regras de segurança: a chave sempre começa pela organização e pelo cliente (nunca mistura dados de outro espaço); leituras com falha
 * parcial não ficam guardadas (o erro não "gruda"); o mesmo pedido em andamento é compartilhado (uma chamada, vários leitores).
 */
export const GOOGLE_READ_CACHE_MS = 5 * 60_000;
const MAX_ENTRIES = 100;

type Entry = { at: number; value: Promise<unknown> };
const entries = new Map<string, Entry>();

export function googleCacheKey(parts: { kind: string; agencyId: string; clientId: string; dateFrom: string; dateTo: string; accountIds?: string[] }): string {
  return [parts.agencyId, parts.clientId, parts.kind, parts.dateFrom, parts.dateTo, [...(parts.accountIds ?? [])].sort().join(",")].join("|");
}

/** Devolve a leitura guardada (ou em andamento) ou executa `load`. `cacheable` decide se o resultado pode ficar guardado. */
export async function cachedGoogleRead<T>(key: string, load: () => Promise<T>, options: { fresh?: boolean; cacheable?: (value: T) => boolean; now?: () => number; ttlMs?: number } = {}): Promise<T> {
  const now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? GOOGLE_READ_CACHE_MS;
  if (!options.fresh) {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttl) return hit.value as Promise<T>;
  }
  const value = load();
  const entry: Entry = { at: now(), value };
  entries.set(key, entry);
  if (entries.size > MAX_ENTRIES) { const oldest = entries.keys().next().value; if (oldest !== undefined && oldest !== key) entries.delete(oldest); }
  try {
    const result = await value;
    if (options.cacheable && !options.cacheable(result) && entries.get(key) === entry) entries.delete(key);
    return result;
  } catch (error) {
    if (entries.get(key) === entry) entries.delete(key);
    throw error;
  }
}

/** Só para testes. */
export function clearGoogleReadCache() { entries.clear(); }
