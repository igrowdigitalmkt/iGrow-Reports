import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { accessCodeMatches, splitLeadFields, type FetchedLead, type LeadFields, type LeadPage } from "./leads";

type Service = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

/** Páginas ativas que recebem os leads desta Página do Facebook (e, se a página restringe a um formulário, só desse formulário). */
export async function findLeadPages(service: Service, pageId: string, formId: string | null): Promise<LeadPage[]> {
  const { data, error } = await service.from("lead_pages").select("id,slug,title,fb_page_id,form_id").eq("fb_page_id", pageId).eq("kind", "facebook").eq("active", true);
  if (error) throw new Error("lead_pages");
  return (data ?? []).filter(row => row.fb_page_id && (!row.form_id || row.form_id === formId)).map(row => ({ id: row.id, slug: row.slug, title: row.title, fbPageId: row.fb_page_id as string, formId: row.form_id }));
}

/** Grava o lead uma única vez por página (o aviso da Meta pode chegar repetido). */
export async function saveLead(service: Service, page: LeadPage, lead: FetchedLead, fields: LeadFields): Promise<string | null> {
  const { data: inserted, error } = await service.from("leads").upsert({
    lead_page_id: page.id, leadgen_id: lead.leadgenId, name: fields.name, phone: fields.phone, email: fields.email,
    field_data: lead.fieldData as never, form_id: lead.formId, ad_id: lead.adId, adset_id: lead.adsetId, campaign_id: lead.campaignId,
    campaign_name: lead.campaignName, adset_name: lead.adsetName, ad_name: lead.adName, platform: lead.platform, is_organic: lead.isOrganic,
    ...(lead.createdTime ? { created_time: lead.createdTime } : {}),
  }, { onConflict: "lead_page_id,leadgen_id", ignoreDuplicates: true }).select("id");
  if (error) throw new Error("leads");
  // Lead já gravado antes de a origem existir: completa só o que ainda está vazio (nunca sobrescreve).
  if (lead.campaignId && lead.campaignName) {
    await service.from("leads").update({ campaign_id: lead.campaignId, campaign_name: lead.campaignName, adset_id: lead.adsetId, adset_name: lead.adsetName, ad_id: lead.adId, ad_name: lead.adName, platform: lead.platform, is_organic: lead.isOrganic })
      .eq("lead_page_id", page.id).eq("leadgen_id", lead.leadgenId).is("campaign_name", null);
  }
  // Só o lead recém-gravado volta aqui (duplicado = null): é o que dispara os alertas.
  return inserted?.[0]?.id ?? null;
}

export type LeadItem = { id: string; name: string | null; phone: string | null; email: string | null; answers: { question: string; answer: string }[]; createdTime: string; receivedAt: string };
export type LeadFeed = { title: string; total: number; today: number; leads: LeadItem[]; serverTime: string };

/** Início do dia de hoje no horário de Brasília (UTC−3, sem horário de verão), em ISO UTC. */
export function startOfTodayBrasilia(now: Date): string {
  const shifted = new Date(now.getTime() - 3 * 3_600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 3)).toISOString();
}

/** Confere o código do link privado e devolve a página; qualquer falha (slug, código, página desativada) é a mesma resposta: null. */
export async function openLeadPage(service: Service, slug: string, code: string | null | undefined) {
  const { data } = await service.from("lead_pages").select("id,title,access_hash,active").eq("slug", slug).maybeSingle();
  if (!data || !data.active || !accessCodeMatches(code, data.access_hash)) return null;
  return { id: data.id, title: data.title };
}

export async function loadLeadFeed(service: Service, page: { id: string; title: string }, now = new Date(), limit = 200): Promise<LeadFeed | null> {
  const [list, total, today] = await Promise.all([
    service.from("leads").select("id,name,phone,email,field_data,created_time,received_at").eq("lead_page_id", page.id).order("created_time", { ascending: false }).limit(limit),
    service.from("leads").select("id", { count: "exact", head: true }).eq("lead_page_id", page.id),
    service.from("leads").select("id", { count: "exact", head: true }).eq("lead_page_id", page.id).gte("created_time", startOfTodayBrasilia(now)),
  ]);
  if (list.error || total.error || today.error) return null;
  return {
    title: page.title, total: total.count ?? 0, today: today.count ?? 0, serverTime: now.toISOString(),
    // Nome, WhatsApp e e-mail guardados na gravação; para leads antigos ou formulários com perguntas próprias, são reconhecidos de novo a partir das respostas.
    leads: (list.data ?? []).map(row => { const { fields, answers } = splitLeadFields(row.field_data); return { id: row.id, name: row.name ?? fields.name, phone: row.phone ?? fields.phone, email: row.email ?? fields.email, answers, createdTime: row.created_time, receivedAt: row.received_at }; }),
  };
}
