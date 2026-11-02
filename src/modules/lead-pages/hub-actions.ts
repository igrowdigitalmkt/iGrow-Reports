"use server";

import { z } from "zod";
import { getMetaApiConfig } from "@/lib/env";
import { subscribePageToLeadgen } from "./connect";
import { appSecretsFromEnv } from "./graph-proof";
import { authorizeLeadsClient } from "./hub-access";
import { createLink, createSource, listLinks, listSources, setSourceActive, updateLink, type LinkView, type SourceView } from "./hub-admin";
import { addLeadNote, changeLeadStatus } from "./hub-query";
import { syncLeadSource } from "./hub-sync";
import { LEAD_STATUSES } from "./hub-types";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };
export type SettingsSnapshot = { sources: SourceView[]; links: LinkView[] };
export type SettingsResult = (SettingsSnapshot & { ok: true; message?: string; code?: string }) | { ok: false; message: string };

const clientId = z.uuid();
const leadId = z.uuid();
const NO_ACCESS = { ok: false as const, message: "Você não tem permissão para esta ação." };

async function snapshot(access: Extract<Awaited<ReturnType<typeof authorizeLeadsClient>>, { allowed: true }>, extra: { message?: string; code?: string } = {}): Promise<SettingsResult> {
  const [sources, links] = await Promise.all([listSources(access.service, access.clientId), listLinks(access.service, access.clientId)]);
  if (!sources || !links) return { ok: false, message: "Não foi possível carregar as configurações." };
  return { ok: true, sources, links, ...extra };
}

export async function setLeadStatusAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ clientId, leadId, status: z.enum(LEAD_STATUSES) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canUpdate) return NO_ACCESS;
  const result = await changeLeadStatus(access.service, { clientId: access.clientId, leadId: parsed.data.leadId, restrictFormIds: null, status: parsed.data.status, actor: access.actor, userId: access.userId });
  return result === "ok" || result === "same" ? { ok: true } : { ok: false, message: result === "not_found" ? "Lead não encontrado." : "Não foi possível salvar. Tente de novo." };
}

export async function addLeadNoteAction(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ clientId, leadId, body: z.string().trim().min(1).max(2000) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Escreva a nota (até 2.000 caracteres)." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canUpdate) return NO_ACCESS;
  const result = await addLeadNote(access.service, { clientId: access.clientId, leadId: parsed.data.leadId, restrictFormIds: null, body: parsed.data.body, actor: access.actor, userId: access.userId });
  return result === "ok" ? { ok: true } : { ok: false, message: result === "not_found" ? "Lead não encontrado." : "Não foi possível salvar a nota." };
}

export async function loadLeadSettingsAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  return snapshot(access);
}

/** Cadastra uma Página do Facebook como fonte de leads do cliente, inscreve no app e já confere a Meta. */
export async function createLeadSourceAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, title: z.string().trim().min(2).max(160), fbPageId: z.string().trim().regex(/^[0-9]{5,30}$/, "O ID da Página tem só números."), formId: z.string().trim().regex(/^[0-9]{5,30}$/).optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira o nome e o ID da Página." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  const created = await createSource(access.service, { agencyId: access.agencyId, clientId: access.clientId, title: parsed.data.title, fbPageId: parsed.data.fbPageId, formId: parsed.data.formId ?? null, userId: access.userId });
  if (!created.ok) return created;
  const connected = await connectAndSync(access, created.id);
  return snapshot(access, { message: connected.message });
}

export async function setLeadSourceActiveAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, sourceId: z.uuid(), active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  if (!await setSourceActive(access.service, { clientId: access.clientId, sourceId: parsed.data.sourceId, active: parsed.data.active })) return { ok: false, message: "Não foi possível alterar." };
  return snapshot(access);
}

/** "Verificar conexão": inscreve a Página no evento de leads (idempotente) e confere formulários e leads na Meta. */
export async function syncLeadSourceAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, sourceId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  const result = await connectAndSync(access, parsed.data.sourceId);
  return snapshot(access, { message: result.message });
}

async function connectAndSync(access: Extract<Awaited<ReturnType<typeof authorizeLeadsClient>>, { allowed: true }>, sourceId: string): Promise<{ message: string }> {
  const { data: source } = await access.service.from("lead_pages").select("id,fb_page_id,slug,title,form_id").eq("id", sourceId).eq("client_id", access.clientId).maybeSingle();
  if (!source) return { message: "Fonte de leads não encontrada." };
  const token = process.env.META_LEADS_ACCESS_TOKEN?.trim();
  const config = getMetaApiConfig();
  if (!token || !config) return { message: "Falta configurar o token de leads (META_LEADS_ACCESS_TOKEN) neste ambiente." };
  const subscribed = await subscribePageToLeadgen({ pageId: source.fb_page_id, token, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv() });
  if (!subscribed.ok) {
    const message = `A Meta não liberou a Página (${subscribed.code}). ${subscribed.message}`.trim();
    await access.service.from("lead_pages").update({ last_synced_at: new Date().toISOString(), sync_error: message.slice(0, 500) }).eq("id", source.id);
    return { message };
  }
  const synced = await syncLeadSource(access.service, { id: source.id, fbPageId: source.fb_page_id, slug: source.slug, title: source.title, formId: source.form_id });
  return { message: synced.ok ? `Conectado. ${synced.forms} formulário(s) e ${synced.leads} lead(s) conferidos na Meta.` : synced.message };
}

export async function createLeadLinkAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, name: z.string().trim().min(2).max(80), formIds: z.array(z.string().regex(/^[0-9]{5,30}$/)).max(50).optional(), canUpdate: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Dê um nome ao link (2 a 80 letras)." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  const created = await createLink(access.service, { agencyId: access.agencyId, clientId: access.clientId, name: parsed.data.name, formIds: parsed.data.formIds ?? null, canUpdate: parsed.data.canUpdate, userId: access.userId });
  if (!created.ok) return created;
  return snapshot(access, { code: created.code, message: "Link criado. Copie agora: por segurança, o código não aparece de novo." });
}

export async function updateLeadLinkAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, linkId: z.uuid(), active: z.boolean().optional(), canUpdate: z.boolean().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  if (!await updateLink(access.service, { clientId: access.clientId, linkId: parsed.data.linkId, active: parsed.data.active, canUpdate: parsed.data.canUpdate })) return { ok: false, message: "Não foi possível alterar o link." };
  return snapshot(access);
}
