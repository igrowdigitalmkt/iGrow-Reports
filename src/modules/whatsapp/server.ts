import "server-only";

import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptServerSecret, encryptServerSecret } from "@/lib/crypto";
import { getEncryptionConfig, getMetaApiConfig } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { META_LOGIN_APP_ID } from "@/modules/meta/login-config";
import type { Database, WhatsAppConnectionRow } from "@/types/database";
import { WhatsAppApiError, WhatsAppGraph } from "./graph";
import { bodyParameterCount, bodyParameters, renderTemplateBody, reportTemplates, SUGGESTED_TEMPLATE, type WhatsAppTemplate } from "./templates";
import { recordInboxMessage } from "./inbox-store";
import { expiryFromDebugToken } from "./token-expiry";

// Numbers connected before migration 202610070010 share one credential per workspace; newer ones
// keep their own, so two numbers from different WhatsApp accounts can live in the same workspace.
const LEGACY_SECRET_KIND = "whatsapp:access_token";
const secretKindFor = (phoneNumberId: string) => `${LEGACY_SECRET_KIND}:${phoneNumberId}`;
const aad = (agencyId: string, integrationId: string, kind: string) => `igrow-reports:${agencyId}:${integrationId}:${kind}`;

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
  return configId && /^\d{5,30}$/.test(configId) && meta ? { configId, apiVersion: meta.apiVersion, appId: whatsAppAppId(META_LOGIN_APP_ID) } : null;
}

type Service = SupabaseClient<Database>;

function dependencies() {
  const service = createSupabaseServiceClient();
  const meta = getMetaApiConfig();
  if (!service || !meta) throw new WhatsAppSetupError("A integração do WhatsApp ainda não está configurada no servidor.");
  return { service, apiVersion: meta.apiVersion };
}

// Before migration 202610070010 there is no `id` column and a workspace has a single number.
async function multiNumberReady(service: Service) {
  const { error } = await service.from("whatsapp_connections").select("id").limit(1);
  return !error;
}

async function readSecret(service: Service, connection: WhatsAppConnectionRow, kind: string) {
  const { data, error } = await service.rpc("get_integration_secret", {
    p_agency_id: connection.agency_id, p_integration_id: connection.integration_id, p_secret_kind: kind,
  }).single();
  if (error || !data) return null;
  return decryptServerSecret({ keyId: data.key_id, nonceB64: data.nonce_b64, ciphertextB64: data.ciphertext_b64, authTagB64: data.auth_tag_b64 }, aad(connection.agency_id, connection.integration_id, kind));
}

async function loadToken(service: Service, connection: WhatsAppConnectionRow) {
  const token = await readSecret(service, connection, secretKindFor(connection.phone_number_id)) ?? await readSecret(service, connection, LEGACY_SECRET_KIND);
  if (!token) throw new WhatsAppSetupError("A credencial do WhatsApp não está disponível. Conecte o número novamente.");
  return token;
}

/** The chosen number, or the first connected one when none is given (single-number workspaces). */
async function loadConnection(service: Service, agencyId: string, connectionId?: string | null) {
  const query = service.from("whatsapp_connections").select("*").eq("agency_id", agencyId);
  const { data, error } = connectionId
    ? await query.eq("id", connectionId).maybeSingle()
    : await query.order("created_at").limit(1).maybeSingle();
  if (error) throw new WhatsAppSetupError("Não foi possível consultar a conexão do WhatsApp.");
  if (!data) throw new WhatsAppSetupError(connectionId ? "Este número não está mais conectado. Escolha outro em Integrações." : "Conecte um número de WhatsApp em Integrações antes de enviar.");
  return data;
}

function pickTemplate(templates: WhatsAppTemplate[], current?: { name: string | null; language: string | null }) {
  const usable = reportTemplates(templates);
  return usable.find(template => template.name === current?.name && template.language === current?.language)
    ?? usable.find(template => template.name === SUGGESTED_TEMPLATE.name) ?? usable[0] ?? null;
}

// When the token stops working (Embedded Signup tokens last 60 days). Unknown is treated as permanent.
async function tokenExpiresAt(accessToken: string, apiVersion: string) {
  const secret = whatsAppAppSecret();
  if (!secret) return null;
  try {
    const query = new URLSearchParams({ input_token: accessToken, access_token: `${whatsAppAppId(META_LOGIN_APP_ID)}|${secret}` });
    const response = await fetch(`https://graph.facebook.com/${apiVersion}/debug_token?${query}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    return response.ok ? expiryFromDebugToken(await response.json()) : null;
  } catch { return null; }
}

/**
 * Adds a number (or refreshes it when the same number is connected again). Before migration
 * 202610070010 the workspace keeps a single number, replaced by the new one.
 */
export async function connectWhatsApp(input: { agencyId: string; wabaId: string; phoneNumberId: string; accessToken: string; coexistence?: boolean }) {
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
  const multi = await multiNumberReady(service);
  // The service client bypasses RLS: never let an upsert move another workspace's number here.
  const { data: owner } = await service.from("whatsapp_connections").select("agency_id").eq("phone_number_id", input.phoneNumberId).maybeSingle();
  if (owner && owner.agency_id !== input.agencyId) throw new WhatsAppSetupError("Este número já está conectado a outro espaço de trabalho.");
  const now = new Date().toISOString();
  const { data: integration, error: integrationError } = await service.from("integrations")
    .upsert({ agency_id: input.agencyId, provider: "whatsapp", connection_status: "connected", health_status: "healthy", last_checked_at: now, last_success_at: now }, { onConflict: "agency_id,provider" })
    .select("id").single();
  if (integrationError || !integration) throw new WhatsAppSetupError("Não foi possível registrar a integração do WhatsApp.");
  const kind = multi ? secretKindFor(input.phoneNumberId) : LEGACY_SECRET_KIND;
  const encrypted = encryptServerSecret(input.accessToken, aad(input.agencyId, integration.id, kind));
  const { error: secretError } = await service.rpc("upsert_integration_secret", {
    p_agency_id: input.agencyId, p_integration_id: integration.id, p_secret_kind: kind,
    p_key_id: encrypted.keyId, p_nonce_b64: encrypted.nonceB64, p_ciphertext_b64: encrypted.ciphertextB64, p_auth_tag_b64: encrypted.authTagB64,
  });
  if (secretError) throw new WhatsAppSetupError("Não foi possível guardar a credencial do WhatsApp com segurança.");
  // Only templates whose name and language fit the stored format can be selected.
  const template = pickTemplate(templates.filter(item => /^[a-z0-9_]{1,512}$/.test(item.name) && /^[a-z]{2,3}(_[A-Z]{2})?$/.test(item.language)));
  const text = (value: string | undefined, max: number) => value ? value.slice(0, max) : null;
  const row = {
    agency_id: input.agencyId, integration_id: integration.id, waba_id: input.wabaId, phone_number_id: input.phoneNumberId,
    display_phone: text(phone.display_phone_number, 40), verified_name: text(phone.verified_name, 200), quality_rating: text(phone.quality_rating, 40),
    template_name: template?.name ?? null, template_language: template?.language ?? null, template_status: text(template?.status, 40),
    last_checked_at: now, updated_at: now,
    ...(multi && input.coexistence !== undefined ? { coexistence: input.coexistence } : {}),
  };
  const conflict = multi ? "phone_number_id" : "agency_id";
  const save = (values: typeof row & { token_expires_at?: string | null }) => service.from("whatsapp_connections").upsert(values, { onConflict: conflict }).select(multi ? "id,agency_id" : "agency_id").single();
  let { data: saved, error } = await save({ ...row, token_expires_at: await tokenExpiresAt(input.accessToken, apiVersion) });
  // Before migration 202610070009 the expiry column does not exist yet.
  if (error?.code === "PGRST204") ({ data: saved, error } = await save(row));
  if (error) {
    console.error("whatsapp-connection-save", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw new WhatsAppSetupError(error.code === "23505" ? "Este número já está conectado a outro espaço de trabalho." : `Não foi possível salvar a conexão do WhatsApp (código ${error.code ?? "desconhecido"}: ${error.message?.slice(0, 160) ?? "sem detalhe"}).`);
  }
  return { connectionId: (saved as { id?: string } | null)?.id ?? null, displayPhone: phone.display_phone_number ?? null, template: template?.name ?? null, usableTemplates: reportTemplates(templates).length };
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
  const result = await connectWhatsApp({ agencyId: input.agencyId, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, accessToken: token.access_token, coexistence: input.coexistence });
  return { ...result, registrationWarning };
}

export async function listWhatsAppTemplates(agencyId: string, connectionId?: string | null) {
  const { service, apiVersion } = dependencies();
  const connection = await loadConnection(service, agencyId, connectionId);
  const templates = await new WhatsAppGraph({ accessToken: await loadToken(service, connection), apiVersion }).templates(connection.waba_id);
  return { all: templates, usable: reportTemplates(templates), selected: { name: connection.template_name, language: connection.template_language } };
}

export async function selectWhatsAppTemplate(agencyId: string, connectionId: string | null, name: string, language: string) {
  const { usable } = await listWhatsAppTemplates(agencyId, connectionId);
  const template = usable.find(item => item.name === name && item.language === language);
  if (!template) throw new WhatsAppSetupError("Esta mensagem modelo não está aprovada ou não tem o PDF no cabeçalho.");
  const { service } = dependencies();
  const update = service.from("whatsapp_connections").update({ template_name: template.name, template_language: template.language, template_status: template.status, updated_at: new Date().toISOString() }).eq("agency_id", agencyId);
  const { error } = connectionId ? await update.eq("id", connectionId) : await update;
  if (error) throw new WhatsAppSetupError("Não foi possível salvar a mensagem modelo.");
}

export async function renameWhatsAppNumber(agencyId: string, connectionId: string, label: string | null) {
  const { service } = dependencies();
  const { error } = await service.from("whatsapp_connections").update({ label, updated_at: new Date().toISOString() }).eq("agency_id", agencyId).eq("id", connectionId);
  if (error) throw new WhatsAppSetupError("Não foi possível renomear o número.");
}

/** Disconnects one number from the iGrow (the number itself keeps working on WhatsApp). */
export async function removeWhatsAppNumber(agencyId: string, connectionId: string) {
  const { service } = dependencies();
  const connection = await loadConnection(service, agencyId, connectionId);
  const { error } = await service.from("whatsapp_connections").delete().eq("agency_id", agencyId).eq("id", connectionId);
  if (error) throw new WhatsAppSetupError("Não foi possível remover o número.");
  await service.rpc("delete_integration_secret", { p_agency_id: agencyId, p_integration_id: connection.integration_id, p_secret_kind: secretKindFor(connection.phone_number_id) });
  const { count } = await service.from("whatsapp_connections").select("id", { count: "exact", head: true }).eq("agency_id", agencyId);
  if (!count) {
    await service.rpc("delete_integration_secret", { p_agency_id: agencyId, p_integration_id: connection.integration_id, p_secret_kind: LEGACY_SECRET_KIND });
    await service.from("integrations").update({ connection_status: "disconnected", updated_at: new Date().toISOString() }).eq("agency_id", agencyId).eq("provider", "whatsapp");
  }
}

export type DeliveryResult = { recipientId: string; name: string; status: "accepted" | "failed" | "skipped"; message?: string };
type PdfRecipient = { id: string; name: string; phone: string; active: boolean; consent_status: string; unsubscribed_at: string | null };

/**
 * Uploads the PDF once and sends the number's approved template to each authorized recipient,
 * with a delivery row per person. The provider's acceptance is not reported as "delivered".
 */
async function sendPdfTemplate(service: Service, apiVersion: string, connection: WhatsAppConnectionRow, input: {
  agencyId: string; clientId: string; clientName: string; period: string; recipients: PdfRecipient[];
  pdf: Blob; filename: string; origin: { report_version_id: string } | { automation_run_id: string }; actorId: string | null;
}): Promise<DeliveryResult[]> {
  if (!connection.template_name || !connection.template_language) throw new WhatsAppSetupError("Escolha em Integrações a mensagem modelo aprovada deste número.");
  const { data: agency } = await service.from("agencies").select("name").eq("id", input.agencyId).single();
  const graph = new WhatsAppGraph({ accessToken: await loadToken(service, connection), apiVersion });
  const templates = await graph.templates(connection.waba_id);
  const template = reportTemplates(templates).find(item => item.name === connection.template_name && item.language === connection.template_language);
  if (!template) throw new WhatsAppSetupError("A mensagem modelo escolhida não está mais aprovada. Escolha outra em Integrações.");
  const mediaId = await graph.uploadPdf(connection.phone_number_id, input.pdf, input.filename);
  const results: DeliveryResult[] = [];
  for (const recipient of input.recipients) {
    if (!recipient.active || recipient.consent_status !== "granted" || recipient.unsubscribed_at) {
      results.push({ recipientId: recipient.id, name: recipient.name, status: "skipped", message: "Sem autorização de recebimento" });
      continue;
    }
    const { data: delivery, error } = await service.from("report_deliveries").insert({
      agency_id: input.agencyId, client_id: input.clientId, recipient_id: recipient.id, ...input.origin,
      ...(connection.id ? { whatsapp_connection_id: connection.id } : {}),
      template_name: template.name, template_language: template.language, status: "sending", created_by: input.actorId,
    }).select("id").single();
    if (error || !delivery) { results.push({ recipientId: recipient.id, name: recipient.name, status: "failed", message: "Não foi possível registrar o envio" }); continue; }
    try {
      const parameters = bodyParameters(bodyParameterCount(template), { recipient: recipient.name.split(" ")[0], client: input.clientName, period: input.period, workspace: agency?.name ?? "" });
      const wamid = await graph.sendTemplate(connection.phone_number_id, recipient.phone, {
        name: template.name, language: template.language,
        components: [
          { type: "header", parameters: [{ type: "document", document: { id: mediaId, filename: input.filename } }] },
          ...(parameters.length ? [{ type: "body", parameters }] : []),
        ],
      });
      await service.from("report_deliveries").update({ status: "accepted", wamid, status_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
      // The report also shows up in this number's conversation in the inbox.
      if (connection.id) await recordInboxMessage(service, { agencyId: input.agencyId, connectionId: connection.id, message: {
        remoteId: recipient.phone.replace(/\D/g, ""), isGroup: false, title: recipient.name, author: null, externalId: wamid, direction: "out",
        kind: "document", body: renderTemplateBody(template, parameters), mediaName: input.filename, mediaMime: "application/pdf", sentAt: new Date().toISOString(),
      } });
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

/** Sends a saved report PDF (generated in the browser) to the chosen recipients. */
export async function sendReportByWhatsApp(input: {
  agencyId: string; clientId: string; reportVersionId: string; recipientIds: string[]; actorId: string;
  pdf: Blob; filename: string; clientName: string; period: string; connectionId?: string | null;
}): Promise<DeliveryResult[]> {
  const { service, apiVersion } = dependencies();
  const connection = await loadConnection(service, input.agencyId, input.connectionId);
  const { data: version } = await service.from("report_versions").select("id,client_id,state").eq("agency_id", input.agencyId).eq("id", input.reportVersionId).maybeSingle();
  if (!version || version.client_id !== input.clientId || version.state === "superseded") throw new WhatsAppSetupError("Este relatório não está disponível para envio.");
  const { data: recipients, error: recipientError } = await service.from("client_recipients").select("id,name,phone,active,consent_status,unsubscribed_at")
    .eq("agency_id", input.agencyId).eq("client_id", input.clientId).in("id", input.recipientIds);
  if (recipientError || !recipients) throw new WhatsAppSetupError("Não foi possível consultar os destinatários.");
  return sendPdfTemplate(service, apiVersion, connection, { ...input, recipients, origin: { report_version_id: input.reportVersionId } });
}

/** Scheduled send through an official number: the PDF of the period, generated on the server. */
export async function sendAutomationPdfByWhatsApp(service: Service, input: {
  agencyId: string; connectionId: string; clientId: string; clientName: string; runId: string; period: string;
  recipients: PdfRecipient[]; pdf: Blob; filename: string;
}) {
  const meta = getMetaApiConfig();
  if (!meta) throw new WhatsAppSetupError("A integração do WhatsApp ainda não está configurada no servidor.");
  const connection = await loadConnection(service, input.agencyId, input.connectionId);
  return sendPdfTemplate(service, meta.apiVersion, connection, { ...input, origin: { automation_run_id: input.runId }, actorId: null });
}

export type FreeFormContent = { text: string } | { file: Blob; filename: string; mime: string; kind: "image" | "video" | "audio" | "document"; caption?: string };

/** Reply from the inbox through an official number (the caller checks the 24-hour window). */
export async function sendOfficialReply(service: Service, input: { agencyId: string; connectionId: string; to: string; content: FreeFormContent }) {
  const meta = getMetaApiConfig();
  if (!meta) throw new WhatsAppSetupError("A integração do WhatsApp ainda não está configurada no servidor.");
  const connection = await loadConnection(service, input.agencyId, input.connectionId);
  const graph = new WhatsAppGraph({ accessToken: await loadToken(service, connection), apiVersion: meta.apiVersion });
  try {
    if ("text" in input.content) return await graph.sendMessage(connection.phone_number_id, input.to, { type: "text", text: input.content.text });
    const { file, filename, mime, kind, caption } = input.content;
    const mediaId = await graph.uploadMedia(connection.phone_number_id, file, filename, mime);
    return await graph.sendMessage(connection.phone_number_id, input.to, kind === "document" ? { type: "document", mediaId, filename, caption }
      : kind === "audio" ? { type: "audio", mediaId } : { type: kind, mediaId, caption });
  } catch (error) {
    if (error instanceof WhatsAppApiError && error.code === "131047") throw new WhatsAppSetupError("Passaram mais de 24 horas desde a última mensagem do cliente. Pela API oficial, só uma mensagem modelo retoma a conversa.");
    if (error instanceof WhatsAppApiError && error.code === "190") throw new WhatsAppSetupError("A autorização da Meta para este número venceu. Reconecte o número em Integrações.");
    throw new WhatsAppSetupError(error instanceof WhatsAppApiError ? `O WhatsApp recusou a mensagem: ${error.message.slice(0, 200)}` : "Não foi possível enviar pelo WhatsApp agora.");
  }
}
