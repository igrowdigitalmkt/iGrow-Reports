import "server-only";

import { getMetaEntityStatuses, type LiveCampaignIdentity, type LiveReadReport } from "@/modules/meta/server";
import type { LiveDeliveryState } from "@/modules/meta/delivery";

// Cache de CURTA duração, só para a VISUALIZAÇÃO de Campanhas: a leitura do catálogo completo na Meta (campanhas, conjuntos e anúncios
// com miniaturas) é a parte mais lenta da tela e se repete a cada filtro ou período. Nunca é usado pelo executor nem por operações de
// escrita: elas sempre consultam o estado real antes de agir. Leituras incompletas não entram no cache. Em ambiente serverless vale por
// instância (melhor esforço); o horário mostrado ao usuário é o da leitura original, nunca o do acerto de cache.
export const LIVE_CACHE_TTL_MS = 45_000;
const MAX_ENTRIES = 40;

type Snapshot = {
  statuses: Record<string, string>; thumbnails: Record<string, string>; catalog: LiveCampaignIdentity[];
  rawStates: Record<string, LiveDeliveryState>; report: LiveReadReport; readAt: number;
};
const store = new Map<string, { expires: number; snapshot: Promise<Snapshot>; accounts: string[] }>();
type Reader = typeof getMetaEntityStatuses;
const complete = (accountIds: string[], report: LiveReadReport) => !report.accountsFailed.length && accountIds.every(id => report.accountsRead.includes(id));

export function clearLiveCache() { store.clear(); }

/** Recorta uma leitura COMPLETA de várias contas para um subconjunto delas (todas as chaves começam por `${conta}:`); nada de outras contas passa. */
function subsetOf(snapshot: Snapshot, ids: string[]): Snapshot {
  const own = new Set(ids);
  const mine = (key: string) => own.has(key.slice(0, key.indexOf(":")));
  const pick = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => mine(key)));
  return {
    statuses: pick(snapshot.statuses), thumbnails: pick(snapshot.thumbnails), rawStates: pick(snapshot.rawStates), readAt: snapshot.readAt,
    catalog: snapshot.catalog.filter(item => own.has(item.accountId)),
    report: { entities: snapshot.report.entities.filter(item => own.has(item.accountId)), accountsRead: snapshot.report.accountsRead.filter(id => own.has(id)), accountsFailed: snapshot.report.accountsFailed.filter(id => own.has(id)) },
  };
}

/**
 * Mesma assinatura de getMetaEntityStatuses; devolve `readAt` pelo callback opcional. Um pedido de subconjunto de contas (ex.: a tela de
 * detalhes de uma conta logo depois da lista de todas) reaproveita uma leitura completa e ainda válida do mesmo cliente que as contenha,
 * em vez de ler a Meta de novo; se essa leitura não cobre todas as contas pedidas, lê de novo.
 */
export function cachedLiveReader(onRead?: (readAt: number, cached: boolean) => void, now: () => number = Date.now, read: Reader = getMetaEntityStatuses): Reader {
  return async (input, thumbnails, catalog, rawStates, report) => {
    const ids = [...input.accountIds].sort();
    const prefix = `${input.agencyId}:${input.clientId}:`;
    const key = `${prefix}${ids.join(",")}`;
    const hit = store.get(key);
    let cached = false;
    let snapshot: Promise<Snapshot>;
    const fresh = () => (async () => {
      const next: Snapshot = { statuses: {}, thumbnails: {}, catalog: [], rawStates: {}, report: { entities: [], accountsRead: [], accountsFailed: [] }, readAt: now() };
      next.statuses = await read(input, next.thumbnails, next.catalog, next.rawStates, next.report);
      return next;
    })();
    if (hit && hit.expires > now()) { snapshot = hit.snapshot; cached = true; }
    else {
      const parent = ids.length ? [...store.entries()].find(([otherKey, entry]) => otherKey !== key && otherKey.startsWith(prefix) && entry.expires > now() && ids.every(id => entry.accounts.includes(id)))?.[1] : undefined;
      let reused = false;
      snapshot = parent
        ? parent.snapshot.then(value => { if (complete(ids, value.report)) { reused = true; return subsetOf(value, ids); } return fresh(); }, () => fresh())
        : fresh();
      store.set(key, { expires: parent ? parent.expires : now() + LIVE_CACHE_TTL_MS, snapshot, accounts: ids });
      if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
      snapshot.then(value => { if (!complete(ids, value.report) && store.get(key)?.snapshot === snapshot) store.delete(key); }, () => store.delete(key));
      void snapshot.then(() => { cached = reused; }, () => undefined);
    }
    const value = await snapshot;
    if (thumbnails) Object.assign(thumbnails, value.thumbnails);
    catalog?.push(...value.catalog);
    if (rawStates) Object.assign(rawStates, value.rawStates);
    if (report) { report.entities.push(...value.report.entities); report.accountsRead.push(...value.report.accountsRead); report.accountsFailed.push(...value.report.accountsFailed); }
    onRead?.(value.readAt, cached);
    return { ...value.statuses };
  };
}
