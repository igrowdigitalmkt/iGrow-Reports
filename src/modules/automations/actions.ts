"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { getClientAnalytics } from "@/modules/client-portal/analytics";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createQrSender } from "@/modules/whatsapp-qr/server";
import { executeAutomation } from "./runner";
import { unknownVariables } from "./message";
import { localDate, nextRunAt, resolvePeriod } from "./schedule";

const PERIODS = ["yesterday", "last_7d", "last_14d", "last_30d", "this_month", "last_month"] as const;
const uuid = z.string().uuid();

const automationSchema = z.object({
  id: uuid.optional(),
  clientId: uuid,
  name: z.string().trim().min(2, "Dê um nome com pelo menos 2 letras.").max(120),
  messageTemplate: z.string().trim().min(1, "Escreva a mensagem.").max(4000, "A mensagem passou de 4.000 caracteres."),
  periodKey: z.enum(PERIODS),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  monthDay: z.number().int().min(1).max(28),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido."),
  active: z.boolean(),
  recipientIds: z.array(uuid).max(50),
  groups: z.array(z.object({ id: z.string().regex(/^[\w.-]+@g\.us$/), name: z.string().trim().min(1).max(200) })).max(20),
}).superRefine((value, ctx) => {
  if (value.frequency === "weekly" && !value.weekdays.length) ctx.addIssue({ code: "custom", message: "Escolha ao menos um dia da semana.", path: ["weekdays"] });
  if (!value.recipientIds.length && !value.groups.length) ctx.addIssue({ code: "custom", message: "Escolha quem vai receber a mensagem.", path: ["recipientIds"] });
  const unknown = unknownVariables(value.messageTemplate);
  if (unknown.length) ctx.addIssue({ code: "custom", message: `Variável desconhecida: {{${unknown[0]}}}. Use os botões de variáveis.`, path: ["messageTemplate"] });
});

const denied = { error: "Leitores não podem alterar agendamentos." };

export async function saveAutomationAction(input: unknown) {
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return denied;
  const value = parsed.data;
  const agencyId = context.agency.id;

  if (value.recipientIds.length) {
    const { data: recipients, error } = await context.supabase.from("client_recipients").select("id,active,consent_status,unsubscribed_at")
      .eq("agency_id", agencyId).eq("client_id", value.clientId).in("id", value.recipientIds);
    if (error) return { error: "Não foi possível conferir os destinatários." };
    const allowed = new Set((recipients ?? []).filter(row => row.active && !row.unsubscribed_at && row.consent_status === "granted").map(row => row.id));
    if (value.recipientIds.some(id => !allowed.has(id))) return { error: "Há destinatário sem autorização de recebimento ou de outro cliente." };
  }

  const timezone = context.agency.timezone || "America/Sao_Paulo";
  const weekdays = value.frequency === "weekly" ? [...new Set(value.weekdays)].sort() : [];
  const next = value.active ? nextRunAt({ frequency: value.frequency, weekdays, monthDay: value.monthDay, sendTime: value.sendTime, timezone }, new Date()) : null;
  const row = {
    agency_id: agencyId, client_id: value.clientId, name: value.name, message_template: value.messageTemplate, period_key: value.periodKey,
    frequency: value.frequency, weekdays: weekdays.length ? weekdays : [1], month_day: value.monthDay, send_time: value.sendTime,
    timezone, active: value.active, next_run_at: next?.toISOString() ?? null, updated_at: new Date().toISOString(),
  };
  const saved = value.id
    ? await context.supabase.from("report_automations").update(row).eq("agency_id", agencyId).eq("id", value.id).select("id").single()
    : await context.supabase.from("report_automations").insert({ ...row, created_by: context.user.id }).select("id").single();
  if (saved.error || !saved.data) return { error: "Não foi possível salvar o agendamento." };
  const automationId = saved.data.id;

  const removed = await context.supabase.from("report_automation_targets").delete().eq("agency_id", agencyId).eq("automation_id", automationId);
  if (removed.error) return { error: "O agendamento foi salvo, mas não foi possível atualizar os destinatários." };
  const targets = [
    ...value.recipientIds.map(recipientId => ({ agency_id: agencyId, automation_id: automationId, client_id: value.clientId, recipient_id: recipientId })),
    ...value.groups.map(group => ({ agency_id: agencyId, automation_id: automationId, client_id: value.clientId, group_id: group.id, group_name: group.name })),
  ];
  const inserted = await context.supabase.from("report_automation_targets").insert(targets);
  if (inserted.error) return { error: "O agendamento foi salvo, mas não foi possível gravar os destinatários." };

  revalidatePath("/dashboard/relatorios/agendamentos");
  return { success: true as const, id: automationId, nextRunAt: row.next_run_at };
}

export async function setAutomationActiveAction(input: unknown) {
  const parsed = z.object({ id: uuid, active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: "Agendamento inválido." };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return denied;
  const { data: current } = await context.supabase.from("report_automations").select("frequency,weekdays,month_day,send_time,timezone")
    .eq("agency_id", context.agency.id).eq("id", parsed.data.id).maybeSingle();
  if (!current) return { error: "Agendamento não encontrado." };
  const next = parsed.data.active ? nextRunAt({ frequency: current.frequency, weekdays: current.weekdays, monthDay: current.month_day, sendTime: current.send_time.slice(0, 5), timezone: current.timezone }, new Date()) : null;
  const { error } = await context.supabase.from("report_automations").update({ active: parsed.data.active, next_run_at: next?.toISOString() ?? null, updated_at: new Date().toISOString() })
    .eq("agency_id", context.agency.id).eq("id", parsed.data.id);
  if (error) return { error: "Não foi possível alterar o agendamento." };
  revalidatePath("/dashboard/relatorios/agendamentos");
  return { success: true as const, nextRunAt: next?.toISOString() ?? null };
}

export async function deleteAutomationAction(input: unknown) {
  const parsed = z.object({ id: uuid }).safeParse(input);
  if (!parsed.success) return { error: "Agendamento inválido." };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return denied;
  const { error } = await context.supabase.from("report_automations").delete().eq("agency_id", context.agency.id).eq("id", parsed.data.id);
  if (error) return { error: "Não foi possível excluir o agendamento." };
  revalidatePath("/dashboard/relatorios/agendamentos");
  return { success: true as const };
}

// Real numbers for the live preview: the same period the next send would use.
export async function previewAutomationDataAction(input: unknown) {
  const parsed = z.object({ clientId: uuid, periodKey: z.enum(PERIODS) }).safeParse(input);
  if (!parsed.success) return { error: "Escolha o cliente e o período." };
  const context = await requireAgencyContext();
  const { dateFrom, dateTo } = resolvePeriod(parsed.data.periodKey, localDate(new Date(), context.agency.timezone || "America/Sao_Paulo"));
  try {
    const data = await getClientAnalytics(context.supabase, parsed.data.clientId, dateFrom, dateTo);
    return { success: true as const, data };
  } catch {
    return { error: "Não foi possível carregar os números deste cliente para a prévia." };
  }
}

// "Enviar agora": same path as the scheduled send (consent re-checked, run recorded), outside
// the schedule. The next scheduled send stays as it was.
export async function sendAutomationNowAction(input: unknown) {
  const parsed = z.object({ id: uuid }).safeParse(input);
  if (!parsed.success) return { error: "Agendamento inválido." };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Leitores não podem enviar mensagens." };
  const { data: automation } = await context.supabase.from("report_automations").select("*").eq("agency_id", context.agency.id).eq("id", parsed.data.id).maybeSingle();
  if (!automation) return { error: "Agendamento não encontrado." };
  const service = createSupabaseServiceClient();
  if (!service) return { error: "O envio não está disponível neste ambiente." };
  const now = new Date();
  const period = resolvePeriod(automation.period_key, localDate(now, automation.timezone));
  const outcome = await executeAutomation(service, automation, { scheduledFor: now, period, trigger: "manual" }, {
    resolveSender: agencyId => createQrSender(agencyId).catch(() => null),
    appUrl: process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? null,
  });
  revalidatePath("/dashboard/relatorios/agendamentos");
  revalidatePath("/dashboard/relatorios/entregas");
  if (!outcome) return { error: "Já existe um envio em andamento para este agendamento. Tente de novo em instantes." };
  return { success: true as const, ...outcome };
}
