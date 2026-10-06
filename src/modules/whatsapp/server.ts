import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptServerSecret, encryptServerSecret } from "@/lib/crypto";
import { getEncryptionConfig, getMetaApiConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Database, WhatsAppConnectionRow } from "@/types/database";
import { WhatsAppApiError, WhatsAppGraph } from "./graph";
import { bodyParameterCount, bodyParameters, reportTemplates, SUGGESTED_TEMPLATE, type WhatsAppTemplate } from "./templates";

const SECRET_KIND = "whatsapp:access_token";
const aad = (agencyId: string, integrationId: string) => `igrow-reports:${agencyId}:${integrationId}:${SECRET_KIND}`;

export class WhatsAppSetupError extends Error {
  constructor(message: string) { super(message); this.name = "WhatsAppSetupError"; }
}

export type WhatsAppReadiness = { ready: boolean; missing: string[] };

// WhatsApp may live in its own Meta app (the Ads app cannot take the WhatsApp use case).
export function whatsAppAppSecret() {
  return process.env.WHATSAPP_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || undefined;
}
export function whatsAppAppId(fallback: string) {
  const value = process.env.WHATSAPP_APP_ID?.trim();
  return value && /^\d{5,30}$/.test(value) ? value : fallback;
}

// Server configuration needed before a workspace can connect a number.
export function whatsAppReadiness(): WhatsAppReadiness {
  const missing: string[] = [];
  if (!createSupabaseServiceClient()) missing.push("acesso privilegiado ao Supabase");
  if (!getEncryptionConfig()) missing.push("chave de criptografia");
  if (!getMetaApiConfig()) missing.push("versão da Graph API");
  if (!whatsAppAppSecret()) missing.push("WHATSAPP_APP_SECRET (assinatura dos avisos)");
  if (!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()) missing.push("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
  return { ready: missing.length === 0, missing };
}

// Embedded Signup needs the configuration created in the Meta app (WhatsApp > Embedded Signup).
export function whatsAppEmbeddedSignup() {
  const configId = process.env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID?.trim();
  const meta = getMetaApiConfig();
  return configId && /^\d{5,30}$/.test(configId) && meta ? { configId, apiVersion: meta.apiVersion } : null;
}

function dependencies() {
  const service = createSupabaseServiceClient();
  const meta = getMetaApiConfig();
  if (!service || !meta) throw new WhatsAppSetupError("A integração do WhatsApp ainda não está configurada no servidor.");
  return { service, apiVersion: meta.apiVersion };
}

async function loadToken(service: SupabaseClient<Database>, connection: WhatsAppConnectionRow) {
  const { data, error } = await service.rpc("get_integration_secret", {
    p_agency_id: connection.agency_id, p_integration_id: connection.integration_id, p_secret_kind: SECRET_KIND,
  }).single();
  if (error || !data) throw new WhatsAppSetupError("A credencial do WhatsApp não está disponível. Conecte o número novamente.");
  return decryptServerSecret({ keyId: data.key_id, nonceB64: data.nonce_b64, ciphertextB64: data.ciphertext_b64, authTagB64: data.auth_tag_b64 }, aad(connection.agency_id, connection.integration_id));
}

async function loadConnection(service: SupabaseClient<Database>, agencyId: string) {
  const { data, error } = await service.from("whatsapp_connections").select("*").eq("agency_id", agencyId).maybeSingle();
  if (error) throw new WhatsAppSetupError("Não foi possível consultar a conexão do WhatsApp.");
  if (!data) throw new WhatsAppSetupError("Conecte um número de WhatsApp em Integrações antes de enviar.");
  return data;
}

function pickTemplate(templates: WhatsAppTemplate[], current?: { name: string | null; language: string | null }) {
  const usable = reportTemplates(templates);
  return usable.find(template => template.name === current?.name && template.language === current?.language)
    ?? usable.find(template => template.name === SUGGESTED_TEMPLATE.name) ?? usable[0] ?? null;
}

export async function connectWhatsApp(input: { agencyId: string; wabaId: string; phoneNumberId: string; accessToken: string }) {
  const { service, apiVersion } = dependencies();
  const graph = new WhatsAppGraph({ accessToken: input.accessToken, apiVersion });
  let phone: Awaited<ReturnType<WhatsAppGraph["phoneNumber"]>>;
  let templates: WhatsAppTemplate[];
  try {
    [phone, templates] = await Promise.all([graph.phoneNumber(input.phoneNumberId), graph.templates(input.wabaId)]);
    // Idempotent: makes sure this account's delivery webhooks reach the iGrow app.
    await graph.subscribeApp(input.wabaId).catch(() => undefined);
  } catch (error) {
    throw new WhatsAppSetupError(error instanceof WhatsAppApiError && error.status === 400
      ? "Identificadores inválidos. Confira o ID da conta do WhatsApp Business e o ID do número."
      : "A Meta não aceitou os dados. Confira o token (permissões whatsapp_business_messaging e whatsapp_business_management) e os IDs.");
  }
  const now = new Date().toISOString();
  const { data: integration, error: integrationError } = await service.from("integrations")
    .upsert({ agency_id: input.agencyId, provider: "whatsapp", connection_status: "connected", health_status: "healthy", last_checked_at: now, last_success_at: now }, { onConflict: "agency_id,provider" })
    .select("id").single();
  if (integrationError || !integration) throw new WhatsAppSetupError("Não foi possível registrar a integração do WhatsApp.");
  const encrypted = encryptServerSecret(input.accessToken, aad(input.agencyId, integration.id));
  const { error: secretError } = await service.rpc("upsert_integration_secret", {
    p_agency_id: input.agencyId, p_integration_id: integration.id, p_secret_kind: SECRET_KIND,
    p_key_id: encrypted.keyId, p_nonce_b64: encrypted.nonceB64, p_ciphertext_b64: encrypted.ciphertextB64, p_auth_tag_b64: encrypted.authTagB64,
  });
  if (secretError) throw new WhatsAppSetupError("Não foi possível guardar a credencial do WhatsApp com segurança.");
  const template = pickTemplate(templates);
  const { error } = await service.from("whatsapp_connections").upsert({
    agency_id: input.agencyId, integration_id: integration.id, waba_id: input.wabaId, phone_number_id: input.phoneNumberId,
    display_phone: phone.display_phone_number ?? null, verified_name: phone.verified_name ?? null, quality_rating: phone.quality_rating ?? null,
    template_name: template?.name ?? null, template_language: template?.language ?? null, template_status: template?.status ?? null,
    last_checked_at: now, updated_at: now,
  }, { onConflict: "agency_id" });
  if (error) {
    console.error("whatsapp-connection-save", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw new WhatsAppSetupError(error.code === "23505" ? "Este número já está conectado a outro espaço de trabalho." : `Não foi possível salvar a conexão do WhatsApp (código ${error.code ?? "desconhecido"}: ${error.message?.slice(0, 160) ?? "sem detalhe"}).`);
  }
  return { displayPhone: phone.display_phone_number ?? null, template: template?.name ?? null, usableTemplates: reportTemplates(templates).length };
}

/**
 * Embedded Signup: the Meta window returns an authorization code plus the chosen account and
 * number. The code becomes a business token here; the rest is the same as a manual connection.
 */
export async function connectWhatsAppEmbedded(input: { agencyId: string; code: string; wabaId: string; phoneNumberId: string; coexistence: boolean; appId: string }) {
  const { apiVersion } = dependencies();
  const secret = whatsAppAppSecret();
  if (!secret) throw new WhatsAppSetupError("A conexão pelo Facebook ainda não está configurada no servidor.");
  const exchange = await fetch(`https://graph.facebook.com/${apiVersion}/oauth/access_token?${new URLSearchParams({ client_id: input.appId, client_secret: secret, code: input.code })}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const token = await exchange.json().catch(() => ({})) as { access_token?: string };
  if (!exchange.ok || !token.access_token) throw new WhatsAppSetupError("A Meta não confirmou a autorização. Tente conectar novamente.");
  const graph = new WhatsAppGraph({ accessToken: token.access_token, apiVersion });
  try { await graph.subscribeApp(input.wabaId); }
  catch { throw new WhatsAppSetupError("Não foi possível ativar os avisos de entrega desta conta do WhatsApp."); }
  let registrationWarning: string | null = null;
  if (!input.coexistence) {
    // Two-step verification PIN for the new number; it can be reset in WhatsApp Manager.
    const pin = String(randomInt(100000, 1000000));
    try { await graph.registerNumber(input.phoneNumberId, pin); }
    catch { registrationWarning = "O número pode precisar ser registrado no Gerenciador do WhatsApp antes do primeiro envio."; }
  }
  const result = await connectWhatsApp({ agencyId: input.agencyId, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, accessToken: token.access_token });
  return { ...result, registrationWarning };
}

export async function listWhatsAppTemplates(agencyId: string) {
  const { service, apiVersion } = dependencies();
  const connection = await loadConnection(service, agencyId);
  const templates = await new WhatsAppGraph({ accessToken: await loadToken(service, connection), apiVersion }).templates(connection.waba_id);
  return { all: templates, usable: reportTemplates(templates), selected: { name: connection.template_name, language: connection.template_language } };
}

export async function selectWhatsAppTemplate(agencyId: string, name: string, language: string) {
  const { usable } = await listWhatsAppTemplates(agencyId);
  const template = usable.find(item => item.name === name && item.language === language);
  if (!template) throw new WhatsAppSetupError("Esta mensagem modelo não está aprovada ou não tem o PDF no cabeçalho.");
  const { service } = dependencies();
  const { error } = await service.from("whatsapp_connections").update({ template_name: template.name, template_language: template.language, template_status: template.status, updated_at: new Date().toISOString() }).eq("agency_id", agencyId);
  if (error) throw new WhatsAppSetupError("Não foi possível salvar a mensagem modelo.");
}

export type DeliveryResult = { recipientId: string; name: string; status: "accepted" | "failed" | "skipped"; message?: string };

/**
 * Sends one report PDF to the chosen recipients with the selected template. Each recipient is
 * re-checked right before sending (active, authorized, not unsubscribed) and gets its own
 * delivery row; the provider's acceptance is not reported as "delivered".
 */
export async function sendReportByWhatsApp(input: {
  agencyId: string; clientId: string; reportVersionId: string; recipientIds: string[]; actorId: string;
  pdf: Blob; filename: string; clientName: string; period: string;
}): Promise<DeliveryResult[]> {
  const { service, apiVersion } = dependencies();
  const connection = await loadConnection(service, input.agencyId);
  if (!connection.template_name || !connection.template_language) throw new WhatsAppSetupError("Escolha em Integrações a mensagem modelo aprovada para envio de relatórios.");
  const { data: version } = await service.from("report_versions").select("id,client_id,state").eq("agency_id", input.agencyId).eq("id", input.reportVersionId).maybeSingle();
  if (!version || version.client_id !== input.clientId || version.state === "superseded") throw new WhatsAppSetupError("Este relatório não está disponível para envio.");
  const { data: recipients, error: recipientError } = await service.from("client_recipients").select("id,name,phone,active,consent_status,unsubscribed_at")
    .eq("agency_id", input.agencyId).eq("client_id", input.clientId).in("id", input.recipientIds);
  if (recipientError || !recipients) throw new WhatsAppSetupError("Não foi possível consultar os destinatários.");
  const { data: agency } = await service.from("agencies").select("name").eq("id", input.agencyId).single();
  const graph = new WhatsAppGraph({ accessToken: await loadToken(service, connection), apiVersion });
  const templates = await graph.templates(connection.waba_id);
  const template = reportTemplates(templates).find(item => item.name === connection.template_name && item.language === connection.template_language);
  if (!template) throw new WhatsAppSetupError("A mensagem modelo escolhida não está mais aprovada. Escolha outra em Integrações.");
  const mediaId = await graph.uploadPdf(connection.phone_number_id, input.pdf, input.filename);
  const results: DeliveryResult[] = [];
  for (const recipient of recipients) {
    if (!recipient.active || recipient.consent_status !== "granted" || recipient.unsubscribed_at) {
      results.push({ recipientId: recipient.id, name: recipient.name, status: "skipped", message: "Sem autorização de recebimento" });
      continue;
    }
    const { data: delivery, error } = await service.from("report_deliveries").insert({
      agency_id: input.agencyId, client_id: input.clientId, recipient_id: recipient.id, report_version_id: input.reportVersionId,
      template_name: template.name, template_language: template.language, status: "sending", created_by: input.actorId,
    }).select("id").single();
    if (error || !delivery) { results.push({ recipientId: recipient.id, name: recipient.name, status: "failed", message: "Não foi possível registrar o envio" }); continue; }
    try {
      const wamid = await graph.sendTemplate(connection.phone_number_id, recipient.phone, {
        name: template.name, language: template.language,
        components: [
          { type: "header", parameters: [{ type: "document", document: { id: mediaId, filename: input.filename } }] },
          ...(bodyParameterCount(template) ? [{ type: "body", parameters: bodyParameters(bodyParameterCount(template), { recipient: recipient.name.split(" ")[0], client: input.clientName, period: input.period, workspace: agency?.name ?? "" }) }] : []),
        ],
      });
      await service.from("report_deliveries").update({ status: "accepted", wamid, status_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
      results.push({ recipientId: recipient.id, name: recipient.name, status: "accepted" });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message.slice(0, 1000) : "Falha no envio";
      // A timeout may still have reached Meta: record it as uncertain instead of failed.
      const uncertain = sendError instanceof Error && sendError.name === "TimeoutError";
      await service.from("report_deliveries").update({ status: uncertain ? "uncertain" : "failed", error_code: sendError instanceof WhatsAppApiError ? sendError.code : null, error_message: message, status_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
      results.push({ recipientId: recipient.id, name: recipient.name, status: "failed", message });
    }
  }
  return results;
}
