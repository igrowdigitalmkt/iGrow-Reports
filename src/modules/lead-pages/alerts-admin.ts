import "server-only";

import { getQrStatus } from "@/modules/whatsapp-qr/server";
import { normalizeAlertPhone, parseSendTimes, parseWeekdays, type AlertRecipient } from "./alerts-core";
import { RECIPIENT_COLUMNS, toRecipient } from "./alerts-send";
import type { Service } from "./hub-query";

export type AlertDelivery = { id: string; kind: "instant" | "digest" | "test"; status: "sent" | "failed" | "skipped"; error: string | null; leadCount: number; createdAt: string };
export type AlertRecipientView = AlertRecipient & { deliveries: AlertDelivery[] };
export type AlertsSnapshot = { recipients: AlertRecipientView[]; sender: "connected" | "disconnected" | "not_configured" };

const ID = /^[0-9]{5,30}$/;

/** Pessoas do cliente (sem as removidas) com os últimos envios de cada uma e o estado do WhatsApp que envia. */
export async function loadAlertsSnapshot(service: Service, input: { agencyId: string; clientId: string }): Promise<AlertsSnapshot | null> {
  const rows = await service.from("lead_alert_recipients").select(RECIPIENT_COLUMNS).eq("client_id", input.clientId).eq("agency_id", input.agencyId).is("removed_at", null).order("created_at");
  if (rows.error) return null;
  const recipients = (rows.data ?? []).map(row => toRecipient(row as Parameters<typeof toRecipient>[0]));
  const deliveries = recipients.length
    ? await service.from("lead_alert_deliveries").select("id,recipient_id,kind,status,error,lead_count,created_at").in("recipient_id", recipients.map(item => item.id)).order("created_at", { ascending: false }).limit(200)
    : { data: [], error: null };
  if (deliveries.error) return null;
  const status = await getQrStatus(input.agencyId).catch(() => null);
  return {
    sender: !status || !status.configured ? "not_configured" : status.state === "connected" ? "connected" : "disconnected",
    recipients: recipients.map(recipient => ({ ...recipient, deliveries: (deliveries.data ?? []).filter(item => item.recipient_id === recipient.id).slice(0, 5)
      .map(item => ({ id: item.id, kind: item.kind, status: item.status, error: item.error, leadCount: item.lead_count, createdAt: item.created_at })) })),
  };
}

export type SaveRecipientInput = {
  agencyId: string; clientId: string; id?: string; name: string; phone: string; mode: "instant" | "scheduled"; sendTimes: string[]; weekdays: number[];
  campaignIds: string[] | null; formIds: string[] | null; consent: boolean; userId: string | null;
};

/** Cria ou atualiza uma pessoa. Cadastro novo (ou número trocado) exige a confirmação de que ela concordou em receber. */
export async function saveAlertRecipient(service: Service, input: SaveRecipientInput): Promise<{ ok: true } | { ok: false; message: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) return { ok: false, message: "Informe o nome (2 a 80 letras)." };
  const phone = normalizeAlertPhone(input.phone);
  if (!phone) return { ok: false, message: "Informe o WhatsApp com DDD, por exemplo (91) 98074-8371." };
  const times = parseSendTimes(input.sendTimes);
  if (!times) return { ok: false, message: "Os horários precisam estar no formato HH:MM (até 12)." };
  if (input.mode === "scheduled" && !times.length) return { ok: false, message: "Escolha pelo menos um horário para o resumo." };
  const weekdays = parseWeekdays(input.weekdays);
  if (!weekdays) return { ok: false, message: "Escolha pelo menos um dia da semana." };
  const clean = (ids: string[] | null) => ids && ids.length ? [...new Set(ids.filter(id => ID.test(id)))].slice(0, 100) : null;
  const values = { name, phone, mode: input.mode, send_times: times, weekdays, campaign_ids: clean(input.campaignIds), form_ids: clean(input.formIds), updated_at: new Date().toISOString() };

  if (input.id) {
    const current = await service.from("lead_alert_recipients").select("phone").eq("id", input.id).eq("client_id", input.clientId).eq("agency_id", input.agencyId).is("removed_at", null).maybeSingle();
    if (!current.data) return { ok: false, message: "Pessoa não encontrada." };
    const phoneChanged = current.data.phone !== phone;
    if (phoneChanged && !input.consent) return { ok: false, message: "Ao trocar o número, confirme que a pessoa concordou em receber os alertas." };
    const { error } = await service.from("lead_alert_recipients").update({ ...values, ...(phoneChanged ? { opted_out_at: null, consent_confirmed_at: new Date().toISOString(), consent_by: input.userId, last_digest_at: null } : {}) })
      .eq("id", input.id).eq("client_id", input.clientId).eq("agency_id", input.agencyId);
    return error ? { ok: false, message: "Não foi possível salvar." } : { ok: true };
  }
  if (!input.consent) return { ok: false, message: "Confirme que a pessoa concordou em receber os alertas." };
  const existing = await service.from("lead_alert_recipients").select("id").eq("client_id", input.clientId).eq("phone", phone).is("removed_at", null).limit(1);
  if ((existing.data ?? []).length) return { ok: false, message: "Este número já está cadastrado neste cliente." };
  const { error } = await service.from("lead_alert_recipients").insert({
    agency_id: input.agencyId, client_id: input.clientId, ...values, consent_confirmed_at: new Date().toISOString(), consent_by: input.userId, created_by: input.userId,
  });
  return error ? { ok: false, message: "Não foi possível cadastrar." } : { ok: true };
}

export async function setAlertRecipientActive(service: Service, input: { agencyId: string; clientId: string; recipientId: string; active: boolean }): Promise<boolean> {
  const { error } = await service.from("lead_alert_recipients").update({ active: input.active, updated_at: new Date().toISOString() })
    .eq("id", input.recipientId).eq("client_id", input.clientId).eq("agency_id", input.agencyId).is("removed_at", null).is("opted_out_at", null);
  return !error;
}

/** Remover = esconder e parar de enviar; o histórico de envios fica guardado. */
export async function removeAlertRecipient(service: Service, input: { agencyId: string; clientId: string; recipientId: string }): Promise<boolean> {
  const now = new Date().toISOString();
  const { error } = await service.from("lead_alert_recipients").update({ removed_at: now, active: false, updated_at: now })
    .eq("id", input.recipientId).eq("client_id", input.clientId).eq("agency_id", input.agencyId).is("removed_at", null);
  return !error;
}
