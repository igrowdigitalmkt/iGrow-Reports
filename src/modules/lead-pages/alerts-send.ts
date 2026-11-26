import "server-only";

import { deliverToDestinations, type MessageSender } from "@/modules/automations/sender";
import { createQrSender } from "@/modules/whatsapp-qr/server";
import { splitLeadFields } from "./leads";
import {
  canReceive, dueDigestSlots, formatDigestMessage, formatInstantMessage, formatTestMessage, isFreshLead, matchesRecipient,
  type AlertLead, type AlertRecipient,
} from "./alerts-core";
import { fallbackFormName } from "./hub-types";
import type { Service } from "./hub-query";

export type SenderResolver = (agencyId: string) => Promise<MessageSender | null>;
export const qrSenderResolver: SenderResolver = agencyId => createQrSender(agencyId).catch(() => null);
const NOT_CONNECTED = "O WhatsApp da Groow não está conectado por QR Code. Conecte em Integrações para enviar os alertas.";
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const defaultPause = () => 4000 + Math.random() * 5000;

type RecipientRow = {
  id: string; name: string; phone: string; mode: string; send_times: string[]; weekdays: number[]; timezone: string; campaign_ids: string[] | null; form_ids: string[] | null;
  active: boolean; opted_out_at: string | null; removed_at: string | null; last_digest_at: string | null; created_at: string; agency_id: string; client_id: string;
};
export const RECIPIENT_COLUMNS = "id,agency_id,client_id,name,phone,mode,send_times,weekdays,timezone,campaign_ids,form_ids,active,opted_out_at,removed_at,last_digest_at,created_at";
export const toRecipient = (row: RecipientRow): AlertRecipient => ({
  id: row.id, name: row.name, phone: row.phone, mode: row.mode === "scheduled" ? "scheduled" : "instant", sendTimes: row.send_times ?? [], weekdays: row.weekdays ?? [0, 1, 2, 3, 4, 5, 6],
  timezone: row.timezone, campaignIds: row.campaign_ids, formIds: row.form_ids, active: row.active, optedOutAt: row.opted_out_at, removedAt: row.removed_at, lastDigestAt: row.last_digest_at, createdAt: row.created_at,
});

/** Leads do cliente no formato dos alertas (com nome do formulário e origem). Aceita janela de datas. */
export async function loadAlertLeads(service: Service, clientId: string, filter: { leadId?: string; after?: Date; until?: Date; limit?: number }): Promise<AlertLead[] | null> {
  const pages = await service.from("lead_pages").select("id").eq("client_id", clientId);
  const pageIds = (pages.data ?? []).map(page => page.id);
  if (pages.error) return null;
  if (!pageIds.length) return [];
  let query = service.from("leads").select("id,name,phone,email,form_id,channel,first_message,handle,field_data,created_time,campaign_id,campaign_name,adset_name,ad_name,platform").in("lead_page_id", pageIds).order("created_time", { ascending: true }).limit(filter.limit ?? 200);
  if (filter.leadId) query = query.eq("id", filter.leadId);
  if (filter.after) query = query.gt("created_time", filter.after.toISOString());
  if (filter.until) query = query.lte("created_time", filter.until.toISOString());
  const [rows, forms] = await Promise.all([query, service.from("lead_forms").select("form_id,name").in("lead_page_id", pageIds)]);
  if (rows.error || forms.error) return null;
  const nameOf = new Map((forms.data ?? []).map(form => [form.form_id, form.name]));
  return (rows.data ?? []).map(row => {
    const { fields, answers } = splitLeadFields(row.field_data);
    return { id: row.id, name: row.name ?? fields.name, phone: row.phone ?? fields.phone, email: row.email ?? fields.email, campaignId: row.campaign_id, campaignName: row.campaign_name,
      adsetName: row.adset_name, adName: row.ad_name, formId: row.form_id, formName: row.form_id ? (nameOf.get(row.form_id) ?? fallbackFormName(row.form_id)) : "", platform: row.platform, answers, createdTime: row.created_time, channel: row.channel, firstMessage: row.first_message, handle: row.handle ?? fields.handle };
  });
}

/** Reserva o envio (a restrição única impede duplicar). Devolve o id da reserva ou null se já foi tratado por outra execução. */
async function claim(service: Service, input: { recipientId: string; leadId: string | null; kind: "instant" | "digest" | "test"; slot: string | null }): Promise<string | null> {
  const { data, error } = await service.from("lead_alert_deliveries").insert({ recipient_id: input.recipientId, lead_id: input.leadId, kind: input.kind, slot: input.slot, status: "skipped", error: "enviando" }).select("id").single();
  if (error) { if (error.code !== "23505") console.error("lead-alert-claim-failed", error.code); return null; }
  return data.id;
}
async function settle(service: Service, id: string, status: "sent" | "failed" | "skipped", error: string | null, leadCount: number) {
  await service.from("lead_alert_deliveries").update({ status, error: error?.slice(0, 300) ?? null, lead_count: leadCount }).eq("id", id);
}

async function clientName(service: Service, clientId: string) {
  const { data } = await service.from("clients").select("name").eq("id", clientId).maybeSingle();
  return data?.name ?? "Cliente";
}

async function deliver(sender: MessageSender | null, recipient: Pick<AlertRecipient, "name" | "phone">, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sender) return { ok: false, error: NOT_CONNECTED };
  const report = await deliverToDestinations(sender, [{ kind: "phone", phone: recipient.phone, label: recipient.name }], text);
  return report.sent ? { ok: true } : { ok: false, error: report.errors[0]?.replace(/^[^:]*: /, "") ?? "o WhatsApp não aceitou a mensagem" };
}

/**
 * Aviso instantâneo de um lead novo para quem está configurado para receber na hora (e cujo filtro de campanha/formulário combina).
 * Cada lead gera no máximo um aviso por pessoa; lead antigo (achado depois na conferência com a Meta) não gera aviso.
 */
export async function notifyNewLead(service: Service, leadId: string, options: { resolveSender?: SenderResolver; now?: Date; pause?: () => number } = {}): Promise<{ sent: number; failed: number }> {
  const now = options.now ?? new Date();
  const result = { sent: 0, failed: 0 };
  const link = await service.from("leads").select("lead_page_id").eq("id", leadId).maybeSingle();
  if (!link.data) return result;
  const page = await service.from("lead_pages").select("agency_id,client_id").eq("id", link.data.lead_page_id).maybeSingle();
  if (!page.data?.client_id) return result;
  const { agency_id: agencyId, client_id: clientId } = page.data;
  const [lead] = (await loadAlertLeads(service, clientId, { leadId })) ?? [];
  if (!lead || !isFreshLead(lead.createdTime, now)) return result;
  const rows = await service.from("lead_alert_recipients").select(RECIPIENT_COLUMNS).eq("client_id", clientId).eq("agency_id", agencyId).is("removed_at", null);
  if (rows.error) return result;
  const targets = (rows.data as RecipientRow[]).map(toRecipient).filter(recipient => recipient.mode === "instant" && canReceive(recipient) && matchesRecipient(recipient, lead));
  if (!targets.length) return result;
  const sender = await (options.resolveSender ?? qrSenderResolver)(agencyId);
  const name = await clientName(service, clientId);
  const text = formatInstantMessage({ clientName: name, lead });
  for (const [index, recipient] of targets.entries()) {
    const deliveryId = await claim(service, { recipientId: recipient.id, leadId: lead.id, kind: "instant", slot: null });
    if (!deliveryId) continue;
    if (index > 0) await wait((options.pause ?? defaultPause)());
    const outcome = await deliver(sender, recipient, text);
    await settle(service, deliveryId, outcome.ok ? "sent" : "failed", outcome.ok ? null : outcome.error, 1);
    if (outcome.ok) result.sent += 1; else result.failed += 1;
  }
  return result;
}

/** Resumos nos horários configurados: roda a cada poucos minutos (agendador da Groow) e envia o que venceu e ainda não foi enviado. */
export async function runDueLeadAlerts(service: Service, options: { resolveSender?: SenderResolver; now?: Date; pause?: () => number } = {}): Promise<{ checked: number; sent: number; skipped: number; failed: number }> {
  const now = options.now ?? new Date();
  const summary = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  const rows = await service.from("lead_alert_recipients").select(RECIPIENT_COLUMNS).eq("mode", "scheduled").eq("active", true).is("removed_at", null).is("opted_out_at", null).limit(500);
  if (rows.error) return summary;
  const senders = new Map<string, MessageSender | null>();
  const names = new Map<string, string>();
  let first = true;
  for (const row of rows.data as RecipientRow[]) {
    const recipient = toRecipient(row);
    for (const slot of dueDigestSlots(recipient, now)) {
      summary.checked += 1;
      const deliveryId = await claim(service, { recipientId: recipient.id, leadId: null, kind: "digest", slot: slot.key });
      if (!deliveryId) continue;
      const since = new Date(recipient.lastDigestAt ?? recipient.createdAt);
      const leads = ((await loadAlertLeads(service, row.client_id, { after: since, until: now, limit: 500 })) ?? []).filter(lead => matchesRecipient(recipient, lead));
      if (!leads.length) { await settle(service, deliveryId, "skipped", null, 0); await service.from("lead_alert_recipients").update({ last_digest_at: now.toISOString() }).eq("id", recipient.id); summary.skipped += 1; continue; }
      if (!senders.has(row.agency_id)) senders.set(row.agency_id, await (options.resolveSender ?? qrSenderResolver)(row.agency_id));
      if (!names.has(row.client_id)) names.set(row.client_id, await clientName(service, row.client_id));
      if (!first) await wait((options.pause ?? defaultPause)());
      first = false;
      const outcome = await deliver(senders.get(row.agency_id) ?? null, recipient, formatDigestMessage({ clientName: names.get(row.client_id)!, leads, since, timezone: recipient.timezone }));
      await settle(service, deliveryId, outcome.ok ? "sent" : "failed", outcome.ok ? null : outcome.error, leads.length);
      // Só avança a data do resumo quando enviou: se falhou, os leads entram no próximo horário.
      if (outcome.ok) { await service.from("lead_alert_recipients").update({ last_digest_at: now.toISOString() }).eq("id", recipient.id); summary.sent += 1; } else summary.failed += 1;
    }
  }
  return summary;
}

const RETRY_WINDOW_MS = 21 * 24 * 3_600_000;
/** Leads por mensagem de resumo (o resumo comum mostra só 12; aqui nenhum lead pode ficar de fora). */
const RESEND_BATCH = 12;
/** Mensagens por execução do agendador: o resto continua na rodada seguinte (poucos minutos depois), sem rajada no WhatsApp. */
const RESEND_MAX_MESSAGES = 8;

/**
 * Reenvio dos avisos instantâneos que falharam só porque o WhatsApp da Groow estava desconectado.
 * Quando a conexão volta, cada pessoa recebe resumos com TODOS os leads que perdeu (últimos 21 dias), em lotes de 12 por mensagem;
 * cada aviso original é marcado como reenviado só depois que o lote dele foi enviado. Sem conexão, nada acontece e a próxima execução tenta de novo.
 */
export async function resendMissedLeadAlerts(service: Service, options: { resolveSender?: SenderResolver; now?: Date; pause?: () => number } = {}): Promise<{ recipients: number; leads: number }> {
  const now = options.now ?? new Date();
  const summary = { recipients: 0, leads: 0 };
  const failed = await service.from("lead_alert_deliveries").select("id,recipient_id,lead_id").eq("kind", "instant").eq("status", "failed").ilike("error", "%não está conectado%")
    .gte("created_at", new Date(now.getTime() - RETRY_WINDOW_MS).toISOString()).order("created_at", { ascending: true }).limit(1000);
  if (failed.error || !failed.data?.length) return summary;
  const byRecipient = new Map<string, Map<string, string[]>>();
  for (const row of failed.data) {
    if (!row.lead_id) continue;
    const leads = byRecipient.get(row.recipient_id) ?? new Map<string, string[]>();
    leads.set(row.lead_id, [...(leads.get(row.lead_id) ?? []), row.id]); byRecipient.set(row.recipient_id, leads);
  }
  const senders = new Map<string, MessageSender | null>();
  let messages = 0;
  for (const [recipientId, byLead] of byRecipient) {
    if (messages >= RESEND_MAX_MESSAGES) break;
    const row = await service.from("lead_alert_recipients").select(RECIPIENT_COLUMNS).eq("id", recipientId).maybeSingle();
    if (row.error || !row.data) continue;
    const recipient = toRecipient(row.data as RecipientRow);
    const allIds = [...byLead.values()].flat();
    const markDone = (ids: string[], note: string) => service.from("lead_alert_deliveries").update({ status: "skipped", error: note }).in("id", ids);
    if (!canReceive(recipient)) { await markDone(allIds, "pessoa inativa: não reenviado"); continue; }
    const agencyId = (row.data as RecipientRow).agency_id;
    if (!senders.has(agencyId)) senders.set(agencyId, await (options.resolveSender ?? qrSenderResolver)(agencyId));
    const sender = senders.get(agencyId) ?? null;
    if (!sender) continue;
    const loaded = (await loadAlertLeads(service, (row.data as RecipientRow).client_id, { after: new Date(now.getTime() - RETRY_WINDOW_MS), limit: 500 })) ?? [];
    const leads = loaded.filter(lead => byLead.has(lead.id) && matchesRecipient(recipient, lead)).sort((a, b) => a.createdTime.localeCompare(b.createdTime));
    const kept = new Set(leads.map(lead => lead.id));
    const dropped = [...byLead].filter(([leadId]) => !kept.has(leadId)).flatMap(([, ids]) => ids);
    if (dropped.length) await markDone(dropped, "sem leads para reenviar");
    const name = leads.length ? await clientName(service, (row.data as RecipientRow).client_id) : "";
    let delivered = 0;
    for (let start = 0; start < leads.length; start += RESEND_BATCH) {
      if (messages >= RESEND_MAX_MESSAGES) break;
      const batch = leads.slice(start, start + RESEND_BATCH);
      const deliveryId = await claim(service, { recipientId, leadId: null, kind: "digest", slot: `retry ${now.toISOString().slice(0, 16)} #${start / RESEND_BATCH + 1}` });
      if (!deliveryId) continue;
      if (messages > 0) await wait((options.pause ?? defaultPause)());
      messages += 1;
      const outcome = await deliver(sender, recipient, formatDigestMessage({ clientName: name, leads: batch, since: new Date(batch[0]!.createdTime), timezone: recipient.timezone }));
      await settle(service, deliveryId, outcome.ok ? "sent" : "failed", outcome.ok ? null : outcome.error, batch.length);
      if (!outcome.ok) break;
      await markDone(batch.flatMap(item => byLead.get(item.id) ?? []), "reenviado em resumo");
      delivered += batch.length;
    }
    if (delivered) { summary.recipients += 1; summary.leads += delivered; }
  }
  return summary;
}

/** Mensagem de teste para uma pessoa (no máximo uma por minuto), para conferir o número antes de ligar os alertas. */
export async function sendAlertTest(service: Service, input: { recipientId: string; clientId: string; resolveSender?: SenderResolver; now?: Date }): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = input.now ?? new Date();
  const row = await service.from("lead_alert_recipients").select(RECIPIENT_COLUMNS).eq("id", input.recipientId).eq("client_id", input.clientId).is("removed_at", null).maybeSingle();
  if (row.error || !row.data) return { ok: false, message: "Pessoa não encontrada." };
  const recipient = toRecipient(row.data as RecipientRow);
  if (recipient.optedOutAt) return { ok: false, message: "Esta pessoa pediu para parar de receber. Cadastre de novo com o consentimento dela." };
  const recent = await service.from("lead_alert_deliveries").select("created_at").eq("recipient_id", recipient.id).eq("kind", "test").gte("created_at", new Date(now.getTime() - 60_000).toISOString()).limit(1);
  if ((recent.data ?? []).length) return { ok: false, message: "Aguarde 1 minuto para enviar outro teste." };
  const deliveryId = await claim(service, { recipientId: recipient.id, leadId: null, kind: "test", slot: null });
  if (!deliveryId) return { ok: false, message: "Não foi possível registrar o teste." };
  const sender = await (input.resolveSender ?? qrSenderResolver)((row.data as RecipientRow).agency_id);
  const outcome = await deliver(sender, recipient, formatTestMessage({ clientName: await clientName(service, input.clientId), recipientName: recipient.name.split(" ")[0] ?? recipient.name }));
  await settle(service, deliveryId, outcome.ok ? "sent" : "failed", outcome.ok ? null : outcome.error, 0);
  return outcome.ok ? { ok: true } : { ok: false, message: outcome.error };
}

/** Quem responde PARAR ao número da Groow deixa de receber os alertas de lead (em toda a organização). */
export async function optOutAlertRecipients(service: Service, agencyId: string, phone: string): Promise<number> {
  const { data } = await service.from("lead_alert_recipients").update({ opted_out_at: new Date().toISOString(), active: false, updated_at: new Date().toISOString() })
    .eq("agency_id", agencyId).eq("phone", phone).is("opted_out_at", null).is("removed_at", null).select("id");
  return data?.length ?? 0;
}
