import "server-only";

import { getMetaApiConfig } from "@/lib/env";
import { graphCall } from "./graph-call";
import { appSecretsFromEnv } from "./graph-proof";

export type MetaPageOption = { id: string; name: string; category: string | null };
export type MetaPagesResult = { ok: true; pages: MetaPageOption[] } | { ok: false; message: string };

const PAGE_SIZE = 100;
const MAX_ROUNDS = 5;

/** Páginas do Facebook que a conexão com a Meta já enxerga (só leitura), para escolher em vez de digitar o ID. */
export async function listMetaPages(): Promise<MetaPagesResult> {
  const token = process.env.META_LEADS_ACCESS_TOKEN?.trim();
  const config = getMetaApiConfig();
  if (!token || !config) return { ok: false, message: "A conexão com a Meta ainda não está configurada neste ambiente." };
  const pages = new Map<string, MetaPageOption>();
  let after: string | null = null;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const response = await graphCall({ token, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv(), path: `me/accounts?fields=id,name,category&limit=${PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ""}` }).catch(() => null);
    if (!response?.ok) return pages.size ? { ok: true, pages: sorted(pages) } : { ok: false, message: `A Meta não listou as Páginas${response ? ` (${response.code})` : ""}. ${response?.message ?? "Tente de novo em instantes."}`.trim() };
    for (const item of Array.isArray(response.body?.data) ? response.body.data as { id?: unknown; name?: unknown; category?: unknown }[] : []) {
      if (typeof item.id !== "string" || !/^[0-9]{5,30}$/.test(item.id)) continue;
      pages.set(item.id, { id: item.id, name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 160) : `Página ${item.id}`, category: typeof item.category === "string" ? item.category.slice(0, 80) : null });
    }
    const paging = response.body?.paging as { cursors?: { after?: unknown }; next?: unknown } | undefined;
    after = paging?.next && typeof paging.cursors?.after === "string" ? paging.cursors.after : null;
    if (!after) break;
  }
  return { ok: true, pages: sorted(pages) };
}

const sorted = (pages: Map<string, MetaPageOption>) => [...pages.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
