import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadAccessToken } from "@/modules/meta/server";
import { graphCall } from "./graph-call";

/**
 * Credenciais da Meta que podem enxergar Páginas e leads: primeiro o token de leads do ambiente (usuário do sistema) e, depois, as conexões
 * Meta já feitas na plataforma (Integrações). Quem já deu acesso às Páginas ali não precisa repetir nada. Nunca registra nem devolve ao navegador.
 */
/** Traduz o erro da Meta sobre permissão em uma orientação clara; os demais seguem com a mensagem da Meta. */
export function explainMetaFailure(code: string, message: string): string {
  if (code.startsWith("10/") || /pages_read_engagement|pages_manage_metadata|leads_retrieval|permission/i.test(message)) {
    return "A conexão com a Meta não tem permissão para esta Página. Em Integrações, reconecte a Meta liberando a Página e as permissões de Páginas e leads (pages_show_list, pages_read_engagement, pages_manage_metadata e leads_retrieval).";
  }
  return `A Meta não liberou a Página (${code}). ${message}`.trim();
}

export async function leadsTokenCandidates(service: SupabaseClient<Database>, agencyId?: string | null): Promise<string[]> {
  const tokens: string[] = [];
  const env = process.env.META_LEADS_ACCESS_TOKEN?.trim();
  if (env) tokens.push(env);
  try {
    let query = service.from("meta_connections").select("id,agency_id,integration_id").not("connected_at", "is", null).order("created_at").limit(40);
    if (agencyId) query = query.eq("agency_id", agencyId);
    const { data } = await query;
    for (const connection of data ?? []) {
      try {
        const token = await loadAccessToken(service, connection.agency_id, connection.integration_id, connection.id);
        if (token && !tokens.includes(token)) tokens.push(token);
      } catch { /* conexão sem credencial legível: ignora */ }
    }
  } catch { /* sem acesso às conexões: segue só com o token do ambiente */ }
  return tokens;
}

const PAGE_ID = /^[0-9]{5,30}$/;

/** Acesso da Página vindo das listas da conta e dos portfólios (não precisa da permissão de leitura do nó da Página). */
async function pageTokenFromLists(token: string, input: { pageId: string; apiVersion: string; appSecrets?: string[] }): Promise<string | null> {
  const find = async (path: string): Promise<string | null> => {
    let after: string | null = null;
    for (let round = 0; round < 5; round += 1) {
      const response = await graphCall({ token, apiVersion: input.apiVersion, appSecrets: input.appSecrets, path: `${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}` }).catch(() => null);
      if (!response?.ok) return null;
      for (const item of Array.isArray(response.body?.data) ? response.body.data as { id?: unknown; access_token?: unknown }[] : []) {
        if (item.id === input.pageId && typeof item.access_token === "string") return item.access_token;
      }
      const paging = response.body?.paging as { cursors?: { after?: unknown }; next?: unknown } | undefined;
      after = paging?.next && typeof paging.cursors?.after === "string" ? paging.cursors.after : null;
      if (!after) return null;
    }
    return null;
  };
  const direct = await find("me/accounts?fields=id,access_token");
  if (direct) return direct;
  const businesses = await graphCall({ token, apiVersion: input.apiVersion, appSecrets: input.appSecrets, path: "me/businesses?fields=id&limit=50" }).catch(() => null);
  for (const business of businesses?.ok && Array.isArray(businesses.body?.data) ? businesses.body.data as { id?: unknown }[] : []) {
    if (typeof business.id !== "string" || !PAGE_ID.test(business.id)) continue;
    const owned = await find(`${business.id}/owned_pages?fields=id,access_token`) ?? await find(`${business.id}/client_pages?fields=id,access_token`);
    if (owned) return owned;
  }
  return null;
}

/** Primeiro token que consegue acessar a Página (devolve o token e o acesso da Página). */
export async function tokenForPage(tokens: string[], input: { pageId: string; apiVersion: string; appSecrets?: string[] }): Promise<{ token: string; pageToken: string } | null> {
  for (const token of tokens) {
    const page = await graphCall({ token, apiVersion: input.apiVersion, appSecrets: input.appSecrets, path: `${encodeURIComponent(input.pageId)}?fields=access_token` }).catch(() => null);
    const pageToken = typeof page?.body?.access_token === "string" ? page.body.access_token : null;
    if (page?.ok && pageToken) return { token, pageToken };
    const listed = await pageTokenFromLists(token, input);
    if (listed) return { token, pageToken: listed };
  }
  return null;
}
