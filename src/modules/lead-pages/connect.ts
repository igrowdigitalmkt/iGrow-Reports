import { graphCall } from "./graph-call";

/**
 * Inscreve a Página do Facebook no app para receber o evento `leadgen` (equivalente a POST /{página}/subscribed_apps no Explorador da
 * Graph API). Usa o token de leads já configurado: pega o token da Página com ele, inscreve e confere. Nunca devolve nem registra tokens.
 */
export type ConnectResult =
  | { ok: true; subscribed: { app: string; fields: string[] }[] }
  | { ok: false; step: "page_token" | "subscribe" | "confirm"; status: number; code: string; message: string };

export async function subscribePageToLeadgen(input: { pageId: string; token: string; apiVersion: string; appSecrets?: string[]; fetchImpl?: typeof fetch }): Promise<ConnectResult> {
  const call = (path: string, token: string, init: { method?: "GET" | "POST"; body?: Record<string, string> } = {}) =>
    graphCall({ path, token, apiVersion: input.apiVersion, appSecrets: input.appSecrets, method: init.method, body: init.body, fetchImpl: input.fetchImpl });

  const page = await call(`${encodeURIComponent(input.pageId)}?fields=access_token`, input.token);
  const pageToken = typeof page.body?.access_token === "string" ? page.body.access_token : null;
  if (!page.ok || !pageToken) return { ok: false, step: "page_token", status: page.status, code: page.code, message: page.message || "A Meta não devolveu o acesso da Página: confira se o usuário do sistema tem esta Página e as permissões de leads." };

  const subscribe = await call(`${encodeURIComponent(input.pageId)}/subscribed_apps`, pageToken, { method: "POST", body: { subscribed_fields: "leadgen" } });
  if (!subscribe.ok || subscribe.body?.success !== true) return { ok: false, step: "subscribe", status: subscribe.status, code: subscribe.code, message: subscribe.message || "A Meta não aceitou a inscrição da Página." };

  const confirm = await call(`${encodeURIComponent(input.pageId)}/subscribed_apps`, pageToken);
  const data = Array.isArray(confirm.body?.data) ? confirm.body.data as { name?: unknown; subscribed_fields?: unknown }[] : [];
  if (!confirm.ok) return { ok: false, step: "confirm", status: confirm.status, code: confirm.code, message: confirm.message || "Não foi possível conferir a inscrição." };
  return { ok: true, subscribed: data.map(item => ({ app: typeof item.name === "string" ? item.name : "app", fields: Array.isArray(item.subscribed_fields) ? item.subscribed_fields.filter((field): field is string => typeof field === "string") : [] })) };
}
