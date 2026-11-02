import "server-only";

import { getMetaApiConfig } from "@/lib/env";
import { graphCall } from "./graph-call";
import { appSecretsFromEnv } from "./graph-proof";

export type MetaPageOption = { id: string; name: string; category: string | null };
export type MetaPagesResult = { ok: true; pages: MetaPageOption[] } | { ok: false; message: string };

const PAGE_SIZE = 100;
const MAX_ROUNDS = 5;

type Row = { id?: unknown; name?: unknown; category?: unknown };

/** Páginas que as conexões com a Meta já enxergam (só leitura): Páginas da conta e as dos portfólios de negócios, para escolher em vez de digitar o ID. */
export async function listMetaPages(tokens: string[]): Promise<MetaPagesResult> {
  const config = getMetaApiConfig();
  if (!config || !tokens.length) return { ok: false, message: "Ainda não há conexão com a Meta neste ambiente. Conecte a Meta em Integrações." };
  const pages = new Map<string, MetaPageOption>();
  let lastError = "";
  const add = (items: unknown) => {
    for (const item of Array.isArray(items) ? items as Row[] : []) {
      if (typeof item.id !== "string" || !/^[0-9]{5,30}$/.test(item.id) || pages.has(item.id)) continue;
      pages.set(item.id, { id: item.id, name: typeof item.name === "string" && item.name.trim() ? item.name.trim().slice(0, 160) : `Página ${item.id}`, category: typeof item.category === "string" ? item.category.slice(0, 80) : null });
    }
  };
  const read = async (token: string, path: string) => {
    let after: string | null = null;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const sep = path.includes("?") ? "&" : "?";
      const response = await graphCall({ token, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv(), path: `${path}${sep}limit=${PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ""}` }).catch(() => null);
      if (!response?.ok) { if (response) lastError = `(${response.code}) ${response.message}`.trim(); return; }
      add(response.body?.data);
      const paging = response.body?.paging as { cursors?: { after?: unknown }; next?: unknown } | undefined;
      after = paging?.next && typeof paging.cursors?.after === "string" ? paging.cursors.after : null;
      if (!after) return;
    }
  };
  for (const token of tokens) {
    await read(token, "me/accounts?fields=id,name,category");
    const businesses = await graphCall({ token, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv(), path: "me/businesses?fields=id&limit=50" }).catch(() => null);
    for (const business of businesses?.ok && Array.isArray(businesses.body?.data) ? businesses.body.data as { id?: unknown }[] : []) {
      if (typeof business.id !== "string" || !/^[0-9]{5,30}$/.test(business.id)) continue;
      await read(token, `${business.id}/owned_pages?fields=id,name,category`);
      await read(token, `${business.id}/client_pages?fields=id,name,category`);
    }
  }
  if (!pages.size && lastError) return { ok: false, message: `A Meta não listou as Páginas ${lastError}`.trim() };
  return { ok: true, pages: [...pages.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) };
}
