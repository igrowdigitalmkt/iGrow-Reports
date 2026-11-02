import "server-only";

import { randomBytes } from "node:crypto";
import { generateAccessCode, hashAccessCode } from "./leads";
import type { Service } from "./hub-query";

/** Gestão das fontes de leads (Páginas do Facebook) e dos links compartilhados de um cliente. Só o servidor chama, depois de autorizar. */

export type SourceView = { id: string; title: string; fbPageId: string; formId: string | null; active: boolean; lastSyncedAt: string | null; syncError: string | null; leadCount: number; lastLeadAt: string | null };
export type LinkView = { id: string; name: string; formIds: string[] | null; canUpdate: boolean; active: boolean; lastOpenedAt: string | null; createdAt: string };

export async function listSources(service: Service, clientId: string): Promise<SourceView[] | null> {
  const { data, error } = await service.from("lead_pages").select("id,title,fb_page_id,form_id,active,last_synced_at,sync_error").eq("client_id", clientId).order("created_at");
  if (error) return null;
  const rows = data ?? [];
  const stats = await Promise.all(rows.map(async row => {
    const [count, last] = await Promise.all([
      service.from("leads").select("id", { count: "exact", head: true }).eq("lead_page_id", row.id),
      service.from("leads").select("created_time").eq("lead_page_id", row.id).order("created_time", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return { count: count.count ?? 0, last: last.data?.created_time ?? null };
  }));
  return rows.map((row, index) => ({ id: row.id, title: row.title, fbPageId: row.fb_page_id, formId: row.form_id, active: row.active, lastSyncedAt: row.last_synced_at, syncError: row.sync_error, leadCount: stats[index]!.count, lastLeadAt: stats[index]!.last }));
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

/** Cria um link e devolve o código UMA vez (só o hash fica guardado). */
export async function createLink(service: Service, input: { agencyId: string; clientId: string; name: string; formIds: string[] | null; canUpdate: boolean; userId: string | null }): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  const code = generateAccessCode();
  const { error } = await service.from("lead_share_links").insert({
    agency_id: input.agencyId, client_id: input.clientId, name: input.name.trim(), access_hash: hashAccessCode(code),
    form_ids: input.formIds && input.formIds.length ? input.formIds : null, can_update: input.canUpdate, created_by: input.userId,
  });
  return error ? { ok: false, message: "Não foi possível criar o link." } : { ok: true, code };
}

export async function updateLink(service: Service, input: { clientId: string; linkId: string; active?: boolean; canUpdate?: boolean }): Promise<boolean> {
  const patch: { active?: boolean; can_update?: boolean; revoked_at?: string | null } = {};
  if (input.active !== undefined) { patch.active = input.active; patch.revoked_at = input.active ? null : new Date().toISOString(); }
  if (input.canUpdate !== undefined) patch.can_update = input.canUpdate;
  const { error } = await service.from("lead_share_links").update(patch).eq("id", input.linkId).eq("client_id", input.clientId);
  return !error;
}
