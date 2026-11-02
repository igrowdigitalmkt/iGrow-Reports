import "server-only";

import { getMetaApiConfig } from "@/lib/env";
import { graphCall } from "./graph-call";
import { appSecretsFromEnv } from "./graph-proof";
import { splitLeadFields, toFetchedLead, type LeadPage } from "./leads";
import { notifyNewLead } from "./alerts-send";
import { saveLead } from "./store";
import { leadsTokenCandidates, tokenForPage } from "./leads-tokens";
import type { Service } from "./hub-query";

const MAX_FORMS = 25;
const LEADS_PER_FORM = 100;
export const SYNC_INTERVAL_MS = 2 * 60_000;

export type SyncResult = { ok: true; forms: number; leads: number } | { ok: false; message: string };

/**
 * Confere a Meta e completa o que o aviso em tempo real deixou passar: lista os formulários da Página (nomes para o filtro) e grava os
 * últimos leads de cada um (o que já existe é ignorado). Só leitura na Meta. O erro é guardado na fonte para aparecer na tela.
 */
export async function syncLeadSource(service: Service, source: { id: string; fbPageId: string; slug: string; title: string; formId: string | null }): Promise<SyncResult> {
  const config = getMetaApiConfig();
  const { data: owner } = await service.from("lead_pages").select("agency_id").eq("id", source.id).maybeSingle();
  const tokens = await leadsTokenCandidates(service, owner?.agency_id);
  const token = tokens[0];
  const finish = async (error: string | null) => { await service.from("lead_pages").update({ last_synced_at: new Date().toISOString(), sync_error: error?.slice(0, 500) ?? null }).eq("id", source.id); };
  if (!token || !config) { await finish("Ainda não há conexão com a Meta neste ambiente. Conecte a Meta em Integrações."); return { ok: false, message: "Token de leads não configurado." }; }
  const secrets = appSecretsFromEnv();
  try {
    const found = await tokenForPage(tokens, { pageId: source.fbPageId, apiVersion: config.apiVersion, appSecrets: secrets });
    if (!found) {
      const page = await graphCall({ token, apiVersion: config.apiVersion, appSecrets: secrets, path: `${encodeURIComponent(source.fbPageId)}?fields=access_token` });
      const message = `A Meta não liberou o acesso à Página (${page.code}). ${page.message}`.trim(); await finish(message); return { ok: false, message };
    }
    const base = { token: found.token, apiVersion: config.apiVersion, appSecrets: secrets };
    const pageToken = found.pageToken;
    const pageBase = { ...base, token: pageToken };

    const formsResponse = await graphCall({ ...pageBase, path: `${encodeURIComponent(source.fbPageId)}/leadgen_forms?fields=id,name,status&limit=${MAX_FORMS}` });
    if (!formsResponse.ok) { const message = `Não foi possível listar os formulários (${formsResponse.code}). ${formsResponse.message}`.trim(); await finish(message); return { ok: false, message }; }
    const forms = (Array.isArray(formsResponse.body?.data) ? formsResponse.body.data as { id?: unknown; name?: unknown; status?: unknown }[] : [])
      .filter(form => typeof form.id === "string" && /^[0-9]{5,30}$/.test(form.id) && (!source.formId || form.id === source.formId))
      .map(form => ({ id: form.id as string, name: typeof form.name === "string" && form.name.trim() ? form.name.trim().slice(0, 300) : `Formulário ${form.id}`, status: typeof form.status === "string" ? form.status.slice(0, 40) : null }));
    if (forms.length) await service.from("lead_forms").upsert(forms.map(form => ({ lead_page_id: source.id, form_id: form.id, name: form.name, status: form.status, updated_at: new Date().toISOString() })), { onConflict: "lead_page_id,form_id" });

    const target: LeadPage = { id: source.id, slug: source.slug, title: source.title, fbPageId: source.fbPageId, formId: source.formId };
    let imported = 0;
    const created: string[] = [];
    for (const form of forms) {
      const leads = await graphCall({ ...pageBase, path: `${form.id}/leads?fields=id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data&limit=${LEADS_PER_FORM}` });
      if (!leads.ok) { const message = `Não foi possível ler os leads de "${form.name}" (${leads.code}). ${leads.message}`.trim(); await finish(message); return { ok: false, message }; }
      for (const item of Array.isArray(leads.body?.data) ? leads.body.data as Record<string, unknown>[] : []) {
        const lead = toFetchedLead(item, String(item.id ?? ""));
        if (!lead.leadgenId || lead.leadgenId.length < 5) continue;
        const id = await saveLead(service, target, { ...lead, formId: lead.formId ?? form.id }, splitLeadFields(lead.fieldData).fields);
        if (id) created.push(id);
        imported += 1;
      }
    }
    await finish(null);
    // Lead recente que o aviso em tempo real deixou passar também gera alerta (os antigos são ignorados pela regra de 60 minutos).
    for (const id of created) await notifyNewLead(service, id).catch(() => undefined);
    return { ok: true, forms: forms.length, leads: imported };
  } catch {
    await finish("A Meta não respondeu a tempo. Tente de novo em instantes.");
    return { ok: false, message: "A Meta não respondeu a tempo." };
  }
}

/** Conferência discreta quando alguém abre a tela: só fontes sem conferência recente, sem travar a página. */
export async function syncStaleSources(service: Service, clientId: string, now = new Date()): Promise<void> {
  const { data } = await service.from("lead_pages").select("id,fb_page_id,slug,title,form_id,last_synced_at").eq("client_id", clientId).eq("active", true);
  const stale = (data ?? []).filter(row => !row.last_synced_at || now.getTime() - new Date(row.last_synced_at).getTime() > SYNC_INTERVAL_MS);
  for (const row of stale) await syncLeadSource(service, { id: row.id, fbPageId: row.fb_page_id, slug: row.slug, title: row.title, formId: row.form_id });
}
