import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { decryptServerSecret, encryptServerSecret } from "@/lib/crypto";
import type { Database } from "@/types/database";
import { GoogleAdsApiError, GoogleAdsClient, type GoogleAdsCredentials } from "./client";

type Service = SupabaseClient<Database>;

export class GoogleAdsSetupError extends Error {
  constructor(message: string) { super(message); this.name = "GoogleAdsSetupError"; }
}

const SECRET_KIND = "google_refresh_token";
const SCOPE = "https://www.googleapis.com/auth/adwords";

/** Credenciais do aplicativo (variáveis de ambiente). Sem elas o Google Ads fica indisponível e o painel avisa o que falta. */
export function googleAdsAppConfig() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  // O token de desenvolvedor é opcional (o Google o desativou em 9/9/2026); se existir, é enviado e ignorado pelo servidor.
  const missing = [!clientId && "GOOGLE_ADS_CLIENT_ID", !clientSecret && "GOOGLE_ADS_CLIENT_SECRET"].filter((name): name is string => !!name);
  return { ready: missing.length === 0, missing, developerToken: developerToken ?? "", clientId: clientId ?? "", clientSecret: clientSecret ?? "" };
}

export function googleRedirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  return base ? `${base}/api/google/oauth/callback` : null;
}

const secretAad = (agencyId: string, integrationId: string) => `igrow-reports:${agencyId}:${integrationId}:${SECRET_KIND}`;

// O parâmetro `state` volta no retorno do Google e prova quem iniciou a conexão (assinado, com validade de 10 minutos).
export function signState(payload: { agencyId: string; userId: string }, secret: string, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ a: payload.agencyId, u: payload.userId, e: now + 10 * 60_000, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function verifyState(state: string, secret: string, now = Date.now()): { agencyId: string; userId: string } | null {
  const [body, signature] = state.split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { a?: string; u?: string; e?: number };
    if (typeof parsed.a !== "string" || typeof parsed.u !== "string" || typeof parsed.e !== "number" || parsed.e < now) return null;
    return { agencyId: parsed.a, userId: parsed.u };
  } catch { return null; }
}

export function buildAuthUrl(input: { clientId: string; redirectUri: string; state: string }) {
  const params = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", scope: SCOPE,
    // Sem "offline" e "consent" o Google não devolve o token de renovação.
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: input.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(input: { code: string; clientId: string; clientSecret: string; redirectUri: string }, fetcher: typeof fetch = fetch) {
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code" }).toString(),
  });
  const body = await response.json().catch(() => ({})) as { refresh_token?: string; scope?: string };
  if (!response.ok || !body.refresh_token) throw new GoogleAdsSetupError("O Google não liberou o acesso. Tente conectar de novo.");
  return { refreshToken: body.refresh_token, scopes: (body.scope ?? SCOPE).split(" ").filter(Boolean) };
}

/** Guarda o token (cifrado) e a conexão da organização. */
export async function saveGoogleConnection(service: Service, input: { agencyId: string; refreshToken: string; scopes: string[] }) {
  const { data: integration, error } = await service.from("integrations")
    .upsert({ agency_id: input.agencyId, provider: "google", connection_status: "connected" }, { onConflict: "agency_id,provider" }).select("id").single();
  if (error || !integration) throw new GoogleAdsSetupError("Não foi possível registrar a integração do Google Ads.");
  const encrypted = encryptServerSecret(input.refreshToken, secretAad(input.agencyId, integration.id));
  const { error: secretError } = await service.rpc("upsert_integration_secret", {
    p_agency_id: input.agencyId, p_integration_id: integration.id, p_secret_kind: SECRET_KIND, p_key_id: encrypted.keyId,
    p_nonce_b64: encrypted.nonceB64, p_ciphertext_b64: encrypted.ciphertextB64, p_auth_tag_b64: encrypted.authTagB64,
  });
  if (secretError) throw new GoogleAdsSetupError("Não foi possível guardar a credencial do Google com segurança.");
  const { error: connectionError } = await service.from("google_connections")
    .upsert({ agency_id: input.agencyId, integration_id: integration.id, scopes: input.scopes, connected_at: new Date().toISOString() }, { onConflict: "agency_id,integration_id" });
  if (connectionError) throw new GoogleAdsSetupError("Não foi possível registrar a conexão do Google Ads.");
  return integration.id;
}

/** Cliente da API para a organização, com o token guardado. */
export async function loadGoogleAdsClient(service: Service, agencyId: string): Promise<{ client: GoogleAdsClient; connectionId: string; loginCustomerId: string | null }> {
  const config = googleAdsAppConfig();
  if (!config.ready) throw new GoogleAdsSetupError(`O Google Ads não está configurado neste ambiente (faltam: ${config.missing.join(", ")}).`);
  const { data: connection } = await service.from("google_connections").select("id,integration_id,login_customer_id").eq("agency_id", agencyId).maybeSingle();
  if (!connection) throw new GoogleAdsSetupError("O Google Ads ainda não foi conectado nesta organização.");
  const { data: secret, error } = await service.rpc("get_integration_secret", { p_agency_id: agencyId, p_integration_id: connection.integration_id, p_secret_kind: SECRET_KIND }).single();
  if (error || !secret) throw new GoogleAdsSetupError("A credencial do Google Ads não está disponível. Conecte novamente.");
  const refreshToken = decryptServerSecret({ keyId: secret.key_id, nonceB64: secret.nonce_b64, ciphertextB64: secret.ciphertext_b64, authTagB64: secret.auth_tag_b64 }, secretAad(agencyId, connection.integration_id));
  const credentials: GoogleAdsCredentials = {
    developerToken: config.developerToken || null, clientId: config.clientId, clientSecret: config.clientSecret, refreshToken, loginCustomerId: connection.login_customer_id,
  };
  return { client: new GoogleAdsClient(credentials), connectionId: connection.id, loginCustomerId: connection.login_customer_id };
}

/** Atualiza a lista de contas de anúncios sob a conta de gerente. Contas que sumiram da lista ficam arquivadas. */
export async function syncGoogleAccounts(service: Service, agencyId: string) {
  const { client, connectionId, loginCustomerId } = await loadGoogleAdsClient(service, agencyId);
  if (!loginCustomerId) throw new GoogleAdsSetupError("Informe o número da conta de gerente (MCC) do Google Ads antes de buscar as contas.");
  let accounts;
  try { accounts = await client.listManagedAccounts(loginCustomerId); }
  catch (error) {
    if (error instanceof GoogleAdsApiError) {
      // Sem segredos: só o status e o código de erro do Google, para o responsável (e o suporte) saberem o que houve.
      console.error("google-ads-list-accounts", { status: error.status, code: error.code });
      const detail = `(${error.code ?? `HTTP ${error.status}`})`;
      throw new GoogleAdsSetupError(error.status === 400 || error.status === 401 ? `O Google recusou o acesso ${detail}. Reconecte a conta e confira o número do gerente.` : `Não foi possível listar as contas no Google Ads agora ${detail}.`);
    }
    throw error;
  }
  const now = new Date().toISOString();
  if (accounts.length) {
    const { error } = await service.from("google_ad_accounts").upsert(accounts.map(account => ({
      agency_id: agencyId, google_connection_id: connectionId, customer_id: account.customerId, name: account.name, currency: account.currency,
      timezone_name: account.timezone, status: account.status, archived_at: null,
    })), { onConflict: "agency_id,google_connection_id,customer_id" });
    if (error) throw new GoogleAdsSetupError("Não foi possível salvar as contas do Google Ads.");
  }
  const seen = new Set(accounts.map(account => account.customerId));
  const { data: existing } = await service.from("google_ad_accounts").select("id,customer_id").eq("agency_id", agencyId).eq("google_connection_id", connectionId).is("archived_at", null);
  const gone = (existing ?? []).filter(row => !seen.has(row.customer_id)).map(row => row.id);
  if (gone.length) await service.from("google_ad_accounts").update({ archived_at: now }).eq("agency_id", agencyId).in("id", gone);
  await service.from("google_connections").update({ last_accounts_sync_at: now }).eq("id", connectionId);
  return { synced: accounts.length, archived: gone.length };
}

export const googleServiceClient = () => {
  const service = createSupabaseServiceClient();
  if (!service) throw new GoogleAdsSetupError("O acesso privilegiado ao Supabase não está configurado.");
  return service;
};
