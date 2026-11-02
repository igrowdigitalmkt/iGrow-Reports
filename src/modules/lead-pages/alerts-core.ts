import { localDate, zonedInstant } from "@/modules/automations/schedule";
import { formatPhone, platformLabel } from "./hub-types";

/** Regras puras dos alertas de lead por WhatsApp: telefone, horários, filtros, vencimento dos resumos e texto das mensagens. */

export type AlertRecipient = {
  id: string; name: string; phone: string; mode: "instant" | "scheduled"; sendTimes: string[]; weekdays: number[]; timezone: string;
  campaignIds: string[] | null; formIds: string[] | null; active: boolean; optedOutAt: string | null; removedAt: string | null; lastDigestAt: string | null; createdAt: string;
};
export type AlertLead = {
  id: string; name: string | null; phone: string | null; email: string | null; campaignId: string | null; campaignName: string | null; adsetName: string | null; adName: string | null;
  formId: string | null; formName: string; platform: string | null; answers: { question: string; answer: string }[]; createdTime: string;
  /** Canal do lead (form quando ausente) e primeira mensagem, para leads de WhatsApp. */
  channel?: "form" | "whatsapp" | "instagram"; firstMessage?: string | null; handle?: string | null;
};

/** "(91) 98074-8371", "91980748371", "+55 91 98074-8371" → "+5591980748371"; sem DDI assume Brasil. Inválido → null. */
export function normalizeAlertPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  if (!digits) return null;
  let full = digits;
  if (!input.trim().startsWith("+")) {
    if (digits.length === 10 || digits.length === 11) full = `55${digits}`;
    else if (!(digits.startsWith("55") && (digits.length === 12 || digits.length === 13))) return null;
  }
  const phone = `+${full}`;
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Lista de horários "HH:MM" válida, sem repetição e em ordem; null se algum for inválido ou passar de 12. */
export function parseSendTimes(times: string[]): string[] | null {
  const clean = times.map(time => time.trim());
  if (clean.length > 12 || clean.some(time => !TIME.test(time))) return null;
  return [...new Set(clean)].sort();
}

export const WEEKDAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export function parseWeekdays(days: number[]): number[] | null {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length >= 1 && unique.length <= 7 && unique.every(day => Number.isInteger(day) && day >= 0 && day <= 6) ? unique : null;
}

/** O lead atende aos filtros de campanha e formulário da pessoa? Filtro vazio = tudo; lead sem campanha não passa por filtro de campanha. */
export function matchesRecipient(recipient: Pick<AlertRecipient, "campaignIds" | "formIds">, lead: Pick<AlertLead, "campaignId" | "formId">): boolean {
  if (recipient.campaignIds?.length && (!lead.campaignId || !recipient.campaignIds.includes(lead.campaignId))) return false;
  if (recipient.formIds?.length && (!lead.formId || !recipient.formIds.includes(lead.formId))) return false;
  return true;
}

/** Quem está apto a receber: ativo, não removido e que não respondeu PARAR. */
export const canReceive = (recipient: Pick<AlertRecipient, "active" | "optedOutAt" | "removedAt">) => recipient.active && !recipient.optedOutAt && !recipient.removedAt;

/** Aviso instantâneo só para lead recente: um lead antigo achado na conferência com a Meta não vira enxurrada de mensagens. */
export const FRESH_LEAD_MS = 60 * 60_000;
export const isFreshLead = (createdTime: string, now: Date) => now.getTime() - new Date(createdTime).getTime() <= FRESH_LEAD_MS && new Date(createdTime).getTime() <= now.getTime() + 5 * 60_000;

/** Resumos já no horário e ainda dentro da tolerância de 3 horas (agendador atrasado ainda entrega; muito atrasado, os leads vão no próximo). */
export const DIGEST_TOLERANCE_MS = 3 * 3_600_000;
export function dueDigestSlots(recipient: Pick<AlertRecipient, "mode" | "sendTimes" | "weekdays" | "timezone">, now: Date): { key: string; at: Date }[] {
  if (recipient.mode !== "scheduled") return [];
  const today = localDate(now, recipient.timezone);
  const yesterday = localDate(new Date(now.getTime() - 86_400_000), recipient.timezone);
  const slots: { key: string; at: Date }[] = [];
  for (const date of [yesterday, today]) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!recipient.weekdays.includes(weekday)) continue;
    for (const time of recipient.sendTimes) {
      const at = zonedInstant(date, time, recipient.timezone);
      if (at.getTime() <= now.getTime() && now.getTime() - at.getTime() <= DIGEST_TOLERANCE_MS) slots.push({ key: `${date} ${time}`, at });
    }
  }
  return slots.sort((a, b) => a.at.getTime() - b.at.getTime());
}

const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
const FOOTER = "—\nAviso automático da Groow Ads. Para parar de receber, responda PARAR.";

function origin(lead: AlertLead): string | null {
  const parts = [lead.campaignName, lead.adsetName, lead.adName].filter(Boolean) as string[];
  const platform = lead.channel === "whatsapp" ? "WhatsApp" : lead.channel === "instagram" ? "Instagram Direct" : platformLabel(lead.platform);
  return parts.length ? `${platform ? `${platform} · ` : ""}${clip(parts.join(" › "), 160)}` : platform;
}

/** Mensagem de um lead novo (aviso instantâneo). */
export function formatInstantMessage(input: { clientName: string; lead: AlertLead }): string {
  const { lead } = input;
  const lines = [`🔔 *Novo lead* · ${input.clientName}`, "", `*${lead.name ? clip(lead.name, 80) : "Sem nome"}*`];
  if (lead.phone) lines.push(`📱 ${formatPhone(lead.phone)}`);
  else if (lead.handle) lines.push(`📷 @${clip(lead.handle, 40)}`);
  if (lead.email) lines.push(`✉️ ${clip(lead.email, 80)}`);
  const from = origin(lead);
  if (from) lines.push(`📣 ${from}`);
  if (lead.channel === "whatsapp" || lead.channel === "instagram") { if (lead.firstMessage) lines.push(`💬 “${clip(lead.firstMessage, 160)}”`); }
  else if (lead.formName) lines.push(`📝 ${clip(lead.formName, 80)}`);
  for (const item of lead.answers.slice(0, 4)) lines.push(`• ${clip(item.question, 70)} ${clip(item.answer, 100)}`);
  if (lead.phone) lines.push("", `👉 Chamar agora: ${waLink(lead.phone)}`);
  lines.push("", FOOTER);
  return lines.join("\n");
}

/** Mensagem de resumo (horários fixos). Lista até 12 leads e informa quantos ficaram de fora. */
export function formatDigestMessage(input: { clientName: string; leads: AlertLead[]; since: Date; timezone: string }): string {
  const sinceText = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(input.since);
  const total = input.leads.length;
  const lines = [`📋 *Resumo de leads* · ${input.clientName}`, `${total} ${total === 1 ? "lead novo" : "leads novos"} desde ${sinceText}`, ""];
  input.leads.slice(0, 12).forEach((lead, index) => {
    const detail = [lead.phone ? formatPhone(lead.phone) : null, origin(lead)].filter(Boolean).join(" · ");
    lines.push(`${index + 1}. *${lead.name ? clip(lead.name, 60) : "Sem nome"}*${detail ? ` · ${clip(detail, 120)}` : ""}`);
  });
  if (total > 12) lines.push(`… e mais ${total - 12}.`);
  lines.push("", FOOTER);
  return lines.join("\n");
}

export function formatTestMessage(input: { clientName: string; recipientName: string }): string {
  return ["✅ *Teste de alerta de leads*", `${input.clientName}`, "", `Oi, ${input.recipientName}! Este é um aviso de teste da Groow Ads: se você recebeu, os alertas de lead novo chegarão neste número.`, "", FOOTER].join("\n");
}
