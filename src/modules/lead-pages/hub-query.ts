import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { splitLeadFields } from "./leads";
import {
  EMPTY_FILTERS, LEAD_CHANNELS, LEAD_STATUSES, fallbackFormName, isLeadChannel, isLeadStatus, periodStart, safeSearch,
  type BoardLead, type LeadChannel, type LeadEvent, type LeadFilters, type LeadsBoardData, type LeadStatus,
} from "./hub-types";

export type Service = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

const AGGREGATE_LIMIT = 5000;
export const LIST_LIMIT = 200;

/**
 * Lê o painel de leads de UM cliente: contagens (por status e formulário), total, hoje e a lista filtrada. `restrictFormIds` (links
 * compartilhados com escopo) limita tudo — inclusive contagens — aos formulários permitidos. Devolve null se o banco falhar.
 */
export async function queryBoard(service: Service, input: { clientId: string; restrictFormIds: string[] | null; filters?: LeadFilters }, now = new Date()): Promise<LeadsBoardData | null> {
  const filters = input.filters ?? EMPTY_FILTERS;
  const pages = await service.from("lead_pages").select("id").eq("client_id", input.clientId);
  if (pages.error) return null;
  const pageIds = (pages.data ?? []).map(page => page.id);
  const empty: LeadsBoardData = { serverTime: now.toISOString(), total: 0, today: 0, statusCounts: { new: 0, contacted: 0, visit: 0, won: 0, lost: 0 }, forms: [], campaigns: [], channels: [], matching: 0, leads: [] };
  if (!pageIds.length) return empty;
  const restrict = input.restrictFormIds;
  if (restrict && !restrict.length) return empty;

  const names = await service.from("lead_forms").select("form_id,name,status").in("lead_page_id", pageIds);
  if (names.error) return null;
  const retired = new Set((names.data ?? []).filter(row => /^(ARCHIVED|DELETED)$/i.test(row.status ?? "")).map(row => row.form_id));
  const nameOf = new Map((names.data ?? []).map(row => [row.form_id, row.name]));

  let base = service.from("leads").select("form_id,status,created_time,campaign_id,campaign_name,channel").in("lead_page_id", pageIds).order("created_time", { ascending: false }).limit(AGGREGATE_LIMIT);
  if (restrict) base = base.in("form_id", restrict);
  const aggregate = await base;
  if (aggregate.error) return null;

  const todayStart = periodStart("today", now)!;
  const statusCounts = { ...empty.statusCounts };
  const formCounts = new Map<string, number>();
  const channelCounts = new Map<LeadChannel, number>();
  const campaignCounts = new Map<string, { name: string; count: number }>();
  let today = 0;
  for (const row of aggregate.data ?? []) {
    if (isLeadStatus(row.status)) statusCounts[row.status] += 1;
    if (row.created_time >= todayStart) today += 1;
    if (isLeadChannel(row.channel)) channelCounts.set(row.channel, (channelCounts.get(row.channel) ?? 0) + 1);
    const key = row.form_id ?? "";
    formCounts.set(key, (formCounts.get(key) ?? 0) + 1);
    if (row.campaign_id) {
      const current = campaignCounts.get(row.campaign_id);
      campaignCounts.set(row.campaign_id, { name: current?.name ?? row.campaign_name ?? `Campanha …${row.campaign_id.slice(-4)}`, count: (current?.count ?? 0) + 1 });
    }
  }
  const campaigns = [...campaignCounts].map(([id, value]) => ({ id, name: value.name, count: value.count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));
  // Formulários conhecidos (mesmo sem lead) + os que já têm lead; os do escopo do link, se houver.
  const formIds = new Set([...nameOf.keys(), ...[...formCounts.keys()].filter(Boolean)]);
  const forms = [...formIds].filter(id => (!restrict || restrict.includes(id)) && (!retired.has(id) || (formCounts.get(id) ?? 0) > 0)).map(id => ({ id, name: nameOf.get(id) ?? fallbackFormName(id), count: formCounts.get(id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR"));

  const channels = LEAD_CHANNELS.filter(channel => channelCounts.has(channel)).map(channel => ({ channel, count: channelCounts.get(channel) ?? 0 }));
  const selectedForms = filters.forms.length ? (restrict ? filters.forms.filter(id => restrict.includes(id)) : filters.forms) : restrict;
  if (selectedForms && !selectedForms.length) return { ...empty, total: (aggregate.data ?? []).length, today, statusCounts, forms, campaigns, channels };
  let list = service.from("leads").select("id,name,phone,email,status,status_changed_at,form_id,channel,first_message,handle,field_data,created_time,campaign_id,campaign_name,adset_name,ad_name,platform", { count: "exact" })
    .in("lead_page_id", pageIds).order("created_time", { ascending: false }).limit(LIST_LIMIT);
  if (selectedForms) list = list.in("form_id", selectedForms);
  if (filters.campaigns.length) list = list.in("campaign_id", filters.campaigns);
  if (filters.channel) list = list.eq("channel", filters.channel);
  if (filters.status.length) list = list.in("status", filters.status);
  const since = periodStart(filters.period, now);
  if (since) list = list.gte("created_time", since);
  const q = safeSearch(filters.q);
  if (q) list = list.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  const result = await list;
  if (result.error) return null;

  const leads: BoardLead[] = (result.data ?? []).map(row => {
    const { fields, answers } = splitLeadFields(row.field_data);
    return {
      id: row.id, name: row.name ?? fields.name, phone: row.phone ?? fields.phone, email: row.email ?? fields.email, answers,
      status: isLeadStatus(row.status) ? row.status : "new", statusChangedAt: row.status_changed_at, formId: row.form_id, channel: row.channel, firstMessage: row.first_message, handle: row.handle,
      formName: row.channel === "whatsapp" ? "WhatsApp" : row.channel === "instagram" ? "Instagram Direct" : row.form_id ? (nameOf.get(row.form_id) ?? fallbackFormName(row.form_id)) : fallbackFormName(null), createdTime: row.created_time,
      campaignId: row.campaign_id, campaignName: row.campaign_name, adsetName: row.adset_name, adName: row.ad_name, platform: row.platform,
    };
  });
  return { serverTime: now.toISOString(), total: (aggregate.data ?? []).length, today, statusCounts, forms, campaigns, channels, matching: result.count ?? leads.length, leads };
}

/** Histórico (status e notas) de um lead do cliente; o lead precisa pertencer ao cliente (e ao escopo de formulários, se houver). */
/** `maskStaff`: para quem vê por link ou pelo portal do cliente, o nome de quem da equipe fez a ação vira "Equipe" (o nome do link é mantido). */
export async function loadLeadEvents(service: Service, input: { clientId: string; leadId: string; restrictFormIds: string[] | null; maskStaff?: boolean }): Promise<LeadEvent[] | null> {
  const lead = await findClientLead(service, input);
  if (!lead) return null;
  const events = await service.from("lead_events").select("id,kind,status,body,actor,created_at").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(100);
  if (events.error) return null;
  return (events.data ?? []).map(row => ({ id: row.id, kind: row.kind, status: isLeadStatus(row.status) ? row.status : null, body: row.body, actor: input.maskStaff && !row.actor.startsWith("Link:") ? "Equipe" : row.actor, createdAt: row.created_at }));
}

/** Lead do cliente (e do escopo permitido) ou null: nunca devolve lead de outro cliente. */
export async function findClientLead(service: Service, input: { clientId: string; leadId: string; restrictFormIds: string[] | null }) {
  const pages = await service.from("lead_pages").select("id").eq("client_id", input.clientId);
  const pageIds = (pages.data ?? []).map(page => page.id);
  if (pages.error || !pageIds.length) return null;
  let query = service.from("leads").select("id,status,form_id").eq("id", input.leadId).in("lead_page_id", pageIds);
  if (input.restrictFormIds) query = query.in("form_id", input.restrictFormIds);
  const { data, error } = await query.maybeSingle();
  return error || !data ? null : { id: data.id, status: isLeadStatus(data.status) ? data.status : ("new" as LeadStatus), formId: data.form_id };
}

/** Muda o status e registra no histórico. Mesmo status não gera evento. */
export async function changeLeadStatus(service: Service, input: { clientId: string; leadId: string; restrictFormIds: string[] | null; status: LeadStatus; actor: string; userId: string | null }): Promise<"ok" | "same" | "not_found" | "error"> {
  if (!LEAD_STATUSES.includes(input.status)) return "error";
  const lead = await findClientLead(service, input);
  if (!lead) return "not_found";
  if (lead.status === input.status) return "same";
  const updated = await service.from("leads").update({ status: input.status, status_changed_at: new Date().toISOString() }).eq("id", lead.id);
  if (updated.error) return "error";
  const event = await service.from("lead_events").insert({ lead_id: lead.id, kind: "status", status: input.status, actor: input.actor.slice(0, 160), created_by: input.userId });
  return event.error ? "error" : "ok";
}

export async function addLeadNote(service: Service, input: { clientId: string; leadId: string; restrictFormIds: string[] | null; body: string; actor: string; userId: string | null }): Promise<"ok" | "not_found" | "error"> {
  const body = input.body.trim();
  if (!body || body.length > 2000) return "error";
  const lead = await findClientLead(service, input);
  if (!lead) return "not_found";
  const event = await service.from("lead_events").insert({ lead_id: lead.id, kind: "note", body, actor: input.actor.slice(0, 160), created_by: input.userId });
  return event.error ? "error" : "ok";
}
