import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMetaApiConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { loadAccessToken } from "@/modules/meta/server";
import type { WritePermissionReason } from "./contracts";

/**
 * Permissão de GERENCIAMENTO de anúncios (ads_management), em cinco conceitos que não se confundem:
 * pedida (configuração do login), concedida (guardada na conexão quando ela foi feita), atualmente válida (lida AGORA em /me/permissions),
 * necessária (pausar, retomar e orçamento) e indisponível. Só a leitura ao vivo prova que ela continua válida.
 */
export type WritePermission = { state: "valid" } | { state: "invalid"; reason: WritePermissionReason };

/** Somente GET em /me/permissions. Nunca registra nem devolve o token. */
export async function probeWritePermission(token: string, version: string, fetchImpl: typeof fetch = fetch): Promise<WritePermission> {
  if (!token.trim() || !/^v\d+\.\d+$/.test(version)) return { state: "invalid", reason: "unverified" };
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${version}/me/permissions?fields=permission,status&limit=100`, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = body && typeof body === "object" && "error" in body ? (body as { error?: { code?: unknown } }).error?.code : undefined;
      return { state: "invalid", reason: code === 190 ? "token_invalid" : "unverified" };
    }
    const list = body && typeof body === "object" && "data" in body && Array.isArray((body as { data: unknown }).data) ? (body as { data: unknown[] }).data : null;
    if (!list) return { state: "invalid", reason: "unverified" };
    const entry = list.find((item): item is { permission: string; status?: unknown } => !!item && typeof item === "object" && (item as { permission?: unknown }).permission === "ads_management");
    if (!entry) return { state: "invalid", reason: "not_granted" };
    if (entry.status === "granted") return { state: "valid" };
    return { state: "invalid", reason: entry.status === "expired" ? "expired" : entry.status === "declined" ? "declined" : "not_granted" };
  } catch { return { state: "invalid", reason: "unverified" }; }
}

export const WRITE_PERMISSION_MESSAGES: Record<WritePermissionReason, string> = {
  not_granted: "Esta conexão está autorizada para consultar dados, mas não concedeu o gerenciamento de anúncios. Para pausar, retomar ou alterar campanhas pela Groow Ads, autorize esta permissão novamente em Integrações.",
  declined: "A permissão de gerenciamento de anúncios foi recusada ou removida na Meta. Reautorize a conexão em Integrações para habilitar as alterações.",
  expired: "A permissão de gerenciamento de anúncios expirou. Reautorize a conexão em Integrações para habilitar as alterações.",
  token_invalid: "A autorização da Meta foi revogada ou expirou. A leitura de dados pode falhar também; reconecte a conta em Integrações.",
  unverified: "Não foi possível confirmar agora a permissão de gerenciamento de anúncios na Meta. Nenhuma ação é oferecida sem essa confirmação; tente novamente.",
};

/** Leitura ao vivo para uma conexão da organização: carrega o token no servidor e confirma a permissão. */
export async function checkWritePermission(service: SupabaseClient<Database>, scope: { agencyId: string; integrationId: string; connectionId: string }): Promise<WritePermission> {
  const apiVersion = getMetaApiConfig()?.apiVersion;
  if (!apiVersion) return { state: "invalid", reason: "unverified" };
  let token: string;
  try { token = await loadAccessToken(service, scope.agencyId, scope.integrationId, scope.connectionId); }
  catch { return { state: "invalid", reason: "token_invalid" }; }
  return probeWritePermission(token, apiVersion);
}
