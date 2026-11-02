import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { decryptServerSecret, encryptServerSecret, type EncryptedSecret } from "@/lib/crypto";
import type { Json } from "@/types/database";
import { accessCodeMatches, generateAccessCode, hashAccessCode } from "./leads";
import type { Service } from "./hub-query";

/** Gestão das fontes de leads (Páginas do Facebook) e dos links compartilhados de um cliente. Só o servidor chama, depois de autorizar. */

export type SourceView = { id: string; title: string; fbPageId: string; formId: string | null; active: boolean; lastSyncedAt: string | null; syncError: string | null; leadCount: number; lastLeadAt: string | null; formCount: number; archivedFormCount: number };
export type LinkView = { id: string; name: string; formIds: string[] | null; canUpdate: boolean; active: boolean; lastOpenedAt: string | null; createdAt: string };

export async function listSources(service: Service, clientId: string): Promise<SourceView[] | null> {
  const { data, error } = await service.from("lead_pages").select("id,title,fb_page_id,form_id,active,last_synced_at,sync_error").eq("client_id", clientId).order("created_at");
  if (error) return null;
  const rows = data ?? [];
  const stats = await Promise.all(rows.map(async row => {
    const [count, last, forms] = await Promise.all([
      service.from("leads").select("id", { count: "exact", head: true }).eq("lead_page_id", row.id),
      service.from("leads").select("created_time").eq("lead_page_id", row.id).order("created_time", { ascending: false }).limit(1).maybeSingle(),
      service.from("lead_forms").select("form_id,status").eq("lead_page_id", row.id),
    ]);
    const scoped = (forms.data ?? []).filter(form => !row.form_id || form.form_id === row.form_id);
    const archived = scoped.filter(form => /^(ARCHIVED|DELETED)$/i.test(form.status ?? "")).length;
    return { count: count.count ?? 0, last: last.data?.created_time ?? null, forms: scoped.length - archived, archived };
  }));
  return rows.map((row, index) => ({ id: row.id, title: row.title, fbPageId: row.fb_page_id, formId: row.form_id, active: row.active, lastSyncedAt: row.last_synced_at, syncError: row.sync_error, leadCount: stats[index]!.count, lastLeadAt: stats[index]!.last, formCount: stats[index]!.forms, archivedFormCount: stats[index]!.archived }));
}

export async function createSource(service: Service, input: { agencyId: string; clientId: string; title: string; fbPageId: string; formId: string | null; userId: string | null }): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const existing = await service.from("lead_pages").select("id,form_id").eq("client_id", input.clientId).eq("fb_page_id", input.fbPageId);
  if ((existing.data ?? []).some(row => (row.form_id ?? null) === input.formId)) return { ok: false, message: "Esta Página já está cadastrada para este cliente." };
  // `slug` e `access_hash` são do modelo original (página única); cada fonte nova recebe valores próprios que nunca são usados como link.
  const slug = `fonte-${randomBytes(6).toString("hex")}`;
  const { data, error } = await service.from("lead_pages").insert({
    agency_id: input.agencyId, client_id: input.clientId, slug, title: input.title.trim().slice(0, 160), fb_page_id: input.fbPageId, form_id: input.formId, access_hash: hashAccessCode(generateAccessCode()),
  }).select("id").single();
  return error || !data ? { ok: false, message: "Não foi possível cadastrar a Página. Confira o ID e tente de novo." } : { ok: true, id: data.id };
}

export async function setSourceActive(service: Service, input: { clientId: string; sourceId: string; active: boolean }): Promise<boolean> {
  const { error } = await service.from("lead_pages").update({ active: input.active, updated_at: new Date().toISOString() }).eq("id", input.sourceId).eq("client_id", input.clientId);
  return !error;
}

export async function listLinks(service: Service, clientId: string): Promise<LinkView[] | null> {
  const { data, error } = await service.from("lead_share_links").select("id,name,form_ids,can_update,active,last_opened_at,created_at").eq("client_id", clientId).order("created_at", { ascending: false });
  if (error) return null;
  return (data ?? []).map(row => ({ id: row.id, name: row.name, formIds: row.form_ids, canUpdate: row.can_update, active: row.active, lastOpenedAt: row.last_opened_at, createdAt: row.created_at }));
}

const linkAad = (linkId: string) => `lead-share-link:${linkId}`;
const seal = (linkId: string, code: string) => { try { return encryptServerSecret(code, linkAad(linkId)) as unknown as Json; } catch { return null; } };

/** Cria um link. O código vai criptografado para o servidor (para copiar de novo) e é devolvido na hora; o acesso é conferido só pelo hash. */
export async function createLink(service: Service, input: { agencyId: string; clientId: string; name: string; formIds: string[] | null; canUpdate: boolean; userId: string | null }): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  const code = generateAccessCode();
  const id = randomUUID();
  const { error } = await service.from("lead_share_links").insert({
    id, agency_id: input.agencyId, client_id: input.clientId, name: input.name.trim(), access_hash: hashAccessCode(code), code_encrypted: seal(id, code),
    form_ids: input.formIds && input.formIds.length ? input.formIds : null, can_update: input.canUpdate, created_by: input.userId,
  });
  return error ? { ok: false, message: "Não foi possível criar o link." } : { ok: true, code };
}

export type LinkPatch = { clientId: string; linkId: string; active?: boolean; canUpdate?: boolean; name?: string; formIds?: string[] | null };
/** Edita um link (nome, formulários visíveis, permissão de atualizar, ativo). O código e o endereço não mudam. */
export async function updateLink(service: Service, input: LinkPatch): Promise<boolean> {
  const patch: { active?: boolean; can_update?: boolean; revoked_at?: string | null; name?: string; form_ids?: string[] | null } = {};
  if (input.active !== undefined) { patch.active = input.active; patch.revoked_at = input.active ? null : new Date().toISOString(); }
  if (input.canUpdate !== undefined) patch.can_update = input.canUpdate;
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.formIds !== undefined) patch.form_ids = input.formIds && input.formIds.length ? input.formIds : null;
  if (!Object.keys(patch).length) return true;
  const { error } = await service.from("lead_share_links").update(patch).eq("id", input.linkId).eq("client_id", input.clientId);
  return !error;
}

/** Exclui o link para sempre: quem tem o endereço perde o acesso e ele não volta. Os leads não são tocados. */
export async function deleteLink(service: Service, input: { clientId: string; linkId: string }): Promise<boolean> {
  const { data } = await service.from("lead_share_links").select("id").eq("id", input.linkId).eq("client_id", input.clientId).maybeSingle();
  if (!data) return false;
  const { error } = await service.from("lead_share_links").delete().eq("id", input.linkId).eq("client_id", input.clientId);
  return !error;
}

/** Gera um código novo para o link: o endereço antigo deixa de valer na hora. Devolve o novo código. */
export async function rotateLinkCode(service: Service, input: { clientId: string; linkId: string }): Promise<{ ok: true; code: string } | { ok: false }> {
  const code = generateAccessCode();
  const { data, error } = await service.from("lead_share_links").update({ access_hash: hashAccessCode(code), code_encrypted: seal(input.linkId, code) }).eq("id", input.linkId).eq("client_id", input.clientId).select("id");
  return error || !data?.length ? { ok: false } : { ok: true, code };
}

/** Lê o código guardado (criptografado) de um link para montar o endereço de novo. null quando o link não guarda o código. */
export async function readLinkCode(service: Service, input: { clientId: string; linkId: string }): Promise<string | null> {
  const { data } = await service.from("lead_share_links").select("access_hash,code_encrypted").eq("id", input.linkId).eq("client_id", input.clientId).maybeSingle();
  if (!data?.code_encrypted || typeof data.code_encrypted !== "object") return null;
  try {
    const code = decryptServerSecret(data.code_encrypted as unknown as EncryptedSecret, linkAad(input.linkId));
    return accessCodeMatches(code, data.access_hash) ? code : null;
  } catch { return null; }
}

/** Link criado antes de existir a cópia: o administrador informa o código atual, o servidor confere com o hash e passa a guardá-lo. O endereço não muda. */
export async function adoptLinkCode(service: Service, input: { clientId: string; linkId: string; code: string }): Promise<boolean> {
  const { data } = await service.from("lead_share_links").select("access_hash").eq("id", input.linkId).eq("client_id", input.clientId).maybeSingle();
  if (!data || !accessCodeMatches(input.code.trim(), data.access_hash)) return false;
  const sealed = seal(input.linkId, input.code.trim());
  if (!sealed) return false;
  const { error } = await service.from("lead_share_links").update({ code_encrypted: sealed }).eq("id", input.linkId).eq("client_id", input.clientId);
  return !error;
}

/** Edita nome e formulário de uma fonte (a Página do Facebook não muda: para outra Página, cadastre uma nova). */
export async function updateSource(service: Service, input: { clientId: string; sourceId: string; title: string; formId: string | null }): Promise<boolean> {
  const { error } = await service.from("lead_pages").update({ title: input.title.trim().slice(0, 160), form_id: input.formId, updated_at: new Date().toISOString() }).eq("id", input.sourceId).eq("client_id", input.clientId);
  return !error;
}

/**
 * Remove uma fonte SÓ se ela nunca recebeu leads (nada é apagado além da própria fonte e do cache de formulários). Com leads, a saída
 * é pausar: os leads continuam no painel.
 */
export async function deleteSource(service: Service, input: { clientId: string; sourceId: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: source } = await service.from("lead_pages").select("id").eq("id", input.sourceId).eq("client_id", input.clientId).maybeSingle();
  if (!source) return { ok: false, message: "Fonte de leads não encontrada." };
  const leads = await service.from("leads").select("id", { count: "exact", head: true }).eq("lead_page_id", source.id);
  if (leads.error) return { ok: false, message: "Não foi possível conferir os leads desta fonte." };
  if ((leads.count ?? 0) > 0) return { ok: false, message: `Esta Página já recebeu ${leads.count} lead(s), que continuam no painel. Para parar de receber, use Pausar em vez de remover.` };
  const forms = await service.from("lead_forms").delete().eq("lead_page_id", source.id);
  if (forms.error) return { ok: false, message: "Não foi possível remover a fonte." };
  const removed = await service.from("lead_pages").delete().eq("id", source.id).eq("client_id", input.clientId);
  return removed.error ? { ok: false, message: "Não foi possível remover a fonte." } : { ok: true };
}
