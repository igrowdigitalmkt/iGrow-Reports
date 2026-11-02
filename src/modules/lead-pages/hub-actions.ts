"use server";

import { z } from "zod";
import { getMetaApiConfig } from "@/lib/env";
import { subscribePageToLeadgen } from "./connect";
import { appSecretsFromEnv } from "./graph-proof";
import { authorizeLeadsClient } from "./hub-access";
import { adoptLinkCode, createLink, createSource, deleteLink, deleteSource, listLinks, listSources, readLinkCode, rotateLinkCode, setSourceActive, updateLink, updateSource, type LinkView, type SourceView } from "./hub-admin";
import { addLeadNote, changeLeadStatus } from "./hub-query";
import { syncLeadSource } from "./hub-sync";
import { leadsTokenCandidates, tokenForPage } from "./leads-tokens";
import { listMetaPages, type MetaPageOption } from "./pages-directory";
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

/** Páginas que a conexão com a Meta enxerga, marcando as que já estão conectadas a este cliente. */
export async function listAvailableLeadPagesAction(input: unknown): Promise<{ ok: true; pages: (MetaPageOption & { connected: boolean })[] } | { ok: false; message: string }> {
  const parsed = z.object({ clientId }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  const [result, sources] = await Promise.all([leadsTokenCandidates(access.service, access.agencyId).then(listMetaPages), listSources(access.service, access.clientId)]);
  if (!result.ok) return result;
  const connected = new Set((sources ?? []).map(source => source.fbPageId));
  return { ok: true, pages: result.pages.map(page => ({ ...page, connected: connected.has(page.id) })) };
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
  const config = getMetaApiConfig();
  const tokens = await leadsTokenCandidates(access.service, access.agencyId);
  if (!tokens.length || !config) return { message: "Ainda não há conexão com a Meta neste ambiente. Conecte a Meta em Integrações." };
  const found = await tokenForPage(tokens, { pageId: source.fb_page_id, apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv() });
  const subscribed = await subscribePageToLeadgen({ pageId: source.fb_page_id, token: found?.token ?? tokens[0], apiVersion: config.apiVersion, appSecrets: appSecretsFromEnv() });
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

/** Edita um link: nome, formulários visíveis, permissão de atualizar e ativo/desativado. O código e o endereço não mudam. */
export async function updateLeadLinkAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({
    clientId, linkId: z.uuid(), active: z.boolean().optional(), canUpdate: z.boolean().optional(), name: z.string().trim().min(2).max(80).optional(),
    formIds: z.array(z.string().regex(/^[0-9]{5,30}$/)).max(50).nullable().optional(),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Confira o nome do link (2 a 80 letras)." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  if (!await updateLink(access.service, { clientId: access.clientId, linkId: parsed.data.linkId, active: parsed.data.active, canUpdate: parsed.data.canUpdate, name: parsed.data.name, formIds: parsed.data.formIds })) return { ok: false, message: "Não foi possível alterar o link." };
  return snapshot(access, parsed.data.name !== undefined || parsed.data.formIds !== undefined ? { message: "Link atualizado." } : {});
}

/** Exclui o link para sempre (os leads não são tocados). */
export async function deleteLeadLinkAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, linkId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  return await deleteLink(access.service, { clientId: access.clientId, linkId: parsed.data.linkId }) ? snapshot(access, { message: "Link excluído. O endereço antigo deixou de funcionar." }) : { ok: false, message: "Não foi possível excluir o link." };
}

/** Gera um código novo para o link (o endereço antigo deixa de valer) e devolve o novo código para copiar. */
export async function rotateLeadLinkAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, linkId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  const rotated = await rotateLinkCode(access.service, { clientId: access.clientId, linkId: parsed.data.linkId });
  return rotated.ok ? snapshot(access, { message: "Novo código gerado. O endereço antigo deixou de funcionar.", code: rotated.code }) : { ok: false, message: "Não foi possível gerar o novo código." };
}

/** Devolve o código guardado do link (só para quem administra) para copiar o endereço de novo. */
export async function getLeadLinkCodeAction(input: unknown): Promise<{ ok: true; code: string } | { ok: false; message: string; needsCode?: boolean }> {
  const parsed = z.object({ clientId, linkId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  const code = await readLinkCode(access.service, { clientId: access.clientId, linkId: parsed.data.linkId });
  return code ? { ok: true, code } : { ok: false, needsCode: true, message: "Este link foi criado antes da cópia e o código não está guardado. Informe o código atual ou gere um novo." };
}

/** Link antigo: guarda o código atual (conferido com o hash) para poder copiar o endereço, sem mudar nada. */
export async function adoptLeadLinkCodeAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, linkId: z.uuid(), code: z.string().trim().min(16).max(128) }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Informe o código do link." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  return await adoptLinkCode(access.service, { clientId: access.clientId, linkId: parsed.data.linkId, code: parsed.data.code }) ? snapshot(access, { message: "Código guardado. Agora você pode copiar o link quando quiser.", code: parsed.data.code }) : { ok: false, message: "Esse código não confere com o deste link." };
}

/** Edita nome e formulário de uma fonte (a Página do Facebook não muda). */
export async function updateLeadSourceAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, sourceId: z.uuid(), title: z.string().trim().min(2).max(160), formId: z.string().trim().regex(/^[0-9]{5,30}$/).nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Confira o nome (2 a 160 letras) e o ID do formulário (só números)." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  return await updateSource(access.service, { clientId: access.clientId, sourceId: parsed.data.sourceId, title: parsed.data.title, formId: parsed.data.formId }) ? snapshot(access, { message: "Fonte atualizada." }) : { ok: false, message: "Não foi possível salvar." };
}

/** Remove a fonte só se nunca recebeu leads; senão orienta a pausar (leads nunca são apagados). */
export async function deleteLeadSourceAction(input: unknown): Promise<SettingsResult> {
  const parsed = z.object({ clientId, sourceId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Pedido inválido." };
  const access = await authorizeLeadsClient(parsed.data.clientId);
  if (!access.allowed || !access.canManage) return NO_ACCESS;
  const removed = await deleteSource(access.service, { clientId: access.clientId, sourceId: parsed.data.sourceId });
  return removed.ok ? snapshot(access, { message: "Fonte removida." }) : removed;
}
