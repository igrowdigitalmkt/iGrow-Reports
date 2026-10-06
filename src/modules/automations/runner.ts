import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";
import type { Database, ReportAutomationRow, ReportAutomationRunRow } from "@/types/database";
import { renderMessage, usedVariables } from "./message";
import { summarizeBalance } from "@/modules/meta/balance";
import { getClientAccountBilling } from "@/modules/meta/server";
import { localDate, nextRunAt, resolvePeriod } from "./schedule";
import { deliverToDestinations, runStatus, type MessageDestination, type MessageSender } from "./sender";

type Service = SupabaseClient<Database>;
export type SenderResolver = (agencyId: string) => Promise<MessageSender | null>;

const NOT_CONNECTED = "WhatsApp não conectado por QR Code. Conecte seu número em Integrações para ativar os envios.";

/** Period, local run date and the following slot for one due automation. */
export function planRun(automation: Pick<ReportAutomationRow, "frequency" | "weekdays" | "month_day" | "send_time" | "timezone" | "period_key" | "next_run_at">, now: Date) {
  const scheduledFor = new Date(automation.next_run_at ?? now.toISOString());
  const runDate = localDate(scheduledFor, automation.timezone);
  const rule = { frequency: automation.frequency, weekdays: automation.weekdays, monthDay: automation.month_day, sendTime: automation.send_time.slice(0, 5), timezone: automation.timezone };
  // Missed slots (server off, long outage) are not replayed: the next one is in the future.
  const after = scheduledFor.getTime() > now.getTime() ? scheduledFor : now;
  return { scheduledFor, period: resolvePeriod(automation.period_key, runDate), next: nextRunAt(rule, after) };
}

export type RunOutcome = { status: "sent" | "partial" | "failed" | "skipped"; sent: number; failed: number; message: string | null; runId: string | null };
type ExecuteOptions = { resolveSender: SenderResolver; pause?: () => number; appUrl?: string | null };

/**
 * Sends one automation for a period and records the run. The unique (automation, slot) row is the
 * lock: when it already exists (another invocation got there first) nothing is sent.
 */
export async function executeAutomation(service: Service, automation: ReportAutomationRow, run: { scheduledFor: Date; period: { dateFrom: string; dateTo: string }; trigger: "schedule" | "manual" }, options: ExecuteOptions): Promise<RunOutcome | null> {
  const base = {
    agency_id: automation.agency_id, automation_id: automation.id, scheduled_for: run.scheduledFor.toISOString(),
    date_from: run.period.dateFrom, date_to: run.period.dateTo,
  };
  // "schedule" is the column default; the origin column only exists after migration 202610070003.
  const payload: typeof base & Partial<ReportAutomationRunRow> = run.trigger === "manual" ? { ...base, trigger: "manual" } : base;
  let claim = await service.from("report_automation_runs").insert(payload).select("id").single();
  if (claim.error?.code === "PGRST204" && run.trigger === "manual") claim = await service.from("report_automation_runs").insert(base).select("id").single();
  const { data: row, error: claimError } = claim;
  if (claimError || !row) return null;

  const finish = async (status: RunOutcome["status"], patch: { message_text?: string; sent_count?: number; failed_count?: number; error_message?: string | null }): Promise<RunOutcome> => {
    const message = patch.error_message?.slice(0, 1000) ?? null;
    await service.from("report_automation_runs").update({ status, finished_at: new Date().toISOString(), ...patch, error_message: message }).eq("id", row.id);
    return { status, sent: patch.sent_count ?? 0, failed: patch.failed_count ?? 0, message, runId: row.id };
  };

  try {
    const sender = await options.resolveSender(automation.agency_id);
    if (!sender) return await finish("skipped", { error_message: NOT_CONNECTED });

    const [{ data: targets }, { data: client }, { data: agency }] = await Promise.all([
      service.from("report_automation_targets").select("recipient_id,group_id,group_name").eq("automation_id", automation.id).eq("agency_id", automation.agency_id),
      service.from("clients").select("name,archived_at").eq("id", automation.client_id).eq("agency_id", automation.agency_id).maybeSingle(),
      service.from("agencies").select("name").eq("id", automation.agency_id).maybeSingle(),
    ]);
    if (!client || client.archived_at) return await finish("skipped", { error_message: "Cliente arquivado ou removido." });
    const recipientIds = (targets ?? []).flatMap(target => target.recipient_id ? [target.recipient_id] : []);
    const { data: recipients } = recipientIds.length
      ? await service.from("client_recipients").select("id,name,phone,active,consent_status,unsubscribed_at").eq("agency_id", automation.agency_id).in("id", recipientIds)
      : { data: [] };
    // Consent is checked again at send time: a recipient may have opted out since the schedule was saved.
    const people = (recipients ?? []).filter(item => item.active && !item.unsubscribed_at && item.consent_status === "granted");
    const groups = (targets ?? []).flatMap(target => target.group_id ? [{ id: target.group_id, name: target.group_name ?? "Grupo" }] : []);
    if (!people.length && !groups.length) return await finish("skipped", { error_message: "Nenhum destinatário autorizado." });

    const { data: payload, error: analyticsError } = await service.rpc("service_client_analytics", {
      p_client_id: automation.client_id, p_date_from: run.period.dateFrom, p_date_to: run.period.dateTo,
    });
    if (analyticsError || !payload) return await finish("failed", { error_message: "Não foi possível ler os números do período." });
    const data = normalizeClientAnalytics(payload);
    // The balance is read live from Meta only when the message shows it.
    const balance = usedVariables(automation.message_template).includes("saldo")
      ? await getClientAccountBilling({ agencyId: automation.agency_id, clientId: automation.client_id }).then(summarizeBalance, () => null) : null;
    const context = { clientName: client.name, workspaceName: agency?.name ?? null, data, balance, dashboardUrl: options.appUrl ? `${options.appUrl}/cliente/${automation.client_id}` : null };

    let sent = 0; let failed = 0; const errors: string[] = [];
    const recipientIdOf = new Map(people.map(person => [person.phone, person.id]));
    // Each person gets their own first name; a group gets the version without a name.
    const deliveries: Array<{ destination: MessageDestination; text: string }> = [
      ...people.map(person => ({ destination: { kind: "phone" as const, phone: person.phone, label: person.name }, text: renderMessage(automation.message_template, { ...context, recipientName: person.name }) })),
      ...groups.map(group => ({ destination: { kind: "group" as const, groupId: group.id, label: group.name }, text: renderMessage(automation.message_template, { ...context, recipientName: "pessoal" }) })),
    ];
    for (const [index, item] of deliveries.entries()) {
      const report = await deliverToDestinations(sender, [item.destination], item.text, options.pause);
      sent += report.sent; failed += report.failed; errors.push(...report.errors);
      // Best effort: without migration 202610070006 the send still counts, only receipts are missing.
      await service.from("automation_messages").insert(report.details.map(detail => ({
        agency_id: automation.agency_id, run_id: row.id, automation_id: automation.id, client_id: automation.client_id,
        recipient_id: detail.destination.kind === "phone" ? recipientIdOf.get(detail.destination.phone) ?? null : null,
        group_id: detail.destination.kind === "group" ? detail.destination.groupId : null,
        destination_label: detail.destination.label.slice(0, 200), message_id: detail.messageId,
        status: detail.ok ? "sent" : "failed", error_message: detail.error?.slice(0, 500) ?? null,
      }))).then(() => undefined, () => undefined);
      if (index < deliveries.length - 1) await new Promise(resolve => setTimeout(resolve, options.pause?.() ?? 4000 + Math.random() * 5000));
    }
    return await finish(runStatus({ sent, failed, errors }), { message_text: deliveries[0].text.slice(0, 6000), sent_count: sent, failed_count: failed, error_message: errors.join(" · ") || null });
  } catch {
    return await finish("failed", { error_message: "Erro inesperado ao executar o agendamento." });
  }
}

export async function runDueAutomations(service: Service, options: ExecuteOptions & { now?: Date; budgetMs?: number }) {
  const now = options.now ?? new Date();
  const started = Date.now();
  const budget = options.budgetMs ?? 240_000;
  const { data: due, error } = await service.from("report_automations").select("*").eq("active", true).lte("next_run_at", now.toISOString())
    .order("next_run_at").limit(25);
  if (error) throw new Error("automations-list-failed");
  const summary = { due: due?.length ?? 0, sent: 0, partial: 0, failed: 0, skipped: 0, deferred: 0 };

  for (const automation of due ?? []) {
    if (Date.now() - started > budget) { summary.deferred += 1; continue; }
    const plan = planRun(automation, now);
    await service.from("report_automations").update({ next_run_at: plan.next?.toISOString() ?? null, last_run_at: now.toISOString() })
      .eq("id", automation.id).eq("agency_id", automation.agency_id);
    const outcome = await executeAutomation(service, automation, { scheduledFor: plan.scheduledFor, period: plan.period, trigger: "schedule" }, options);
    if (outcome) summary[outcome.status] += 1;
  }
  return summary;
}
