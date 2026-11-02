import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { loadAccessToken } from "@/modules/meta/server";
import { graphCall } from "./graph-call";

/**
 * Credenciais da Meta que podem enxergar Páginas e leads: primeiro o token de leads do ambiente (usuário do sistema) e, depois, as conexões
 * Meta já feitas na plataforma (Integrações). Quem já deu acesso às Páginas ali não precisa repetir nada. Nunca registra nem devolve ao navegador.
 */
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

/** Primeiro token que consegue acessar a Página (devolve o token e o acesso da Página). */
export async function tokenForPage(tokens: string[], input: { pageId: string; apiVersion: string; appSecrets?: string[] }): Promise<{ token: string; pageToken: string } | null> {
  for (const token of tokens) {
    const page = await graphCall({ token, apiVersion: input.apiVersion, appSecrets: input.appSecrets, path: `${encodeURIComponent(input.pageId)}?fields=access_token` }).catch(() => null);
    const pageToken = typeof page?.body?.access_token === "string" ? page.body.access_token : null;
    if (page?.ok && pageToken) return { token, pageToken };
  }
  return null;
}
