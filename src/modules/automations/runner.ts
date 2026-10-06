import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";
import type { Database, ReportAutomationRow } from "@/types/database";
import { renderMessage } from "./message";
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

export async function runDueAutomations(service: Service, options: { now?: Date; resolveSender: SenderResolver; budgetMs?: number; pause?: () => number; appUrl?: string | null }) {
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
    // The unique (automation, slot) row is the lock: a concurrent invocation stops here.
    const { data: run, error: claimError } = await service.from("report_automation_runs").insert({
      agency_id: automation.agency_id, automation_id: automation.id, scheduled_for: plan.scheduledFor.toISOString(),
      date_from: plan.period.dateFrom, date_to: plan.period.dateTo,
    }).select("id").single();
    await service.from("report_automations").update({ next_run_at: plan.next?.toISOString() ?? null, last_run_at: now.toISOString() })
      .eq("id", automation.id).eq("agency_id", automation.agency_id);
    if (claimError || !run) continue;

    const finish = async (status: "sent" | "partial" | "failed" | "skipped", patch: { message_text?: string; sent_count?: number; failed_count?: number; error_message?: string | null }) => {
      summary[status] += 1;
      await service.from("report_automation_runs").update({ status, finished_at: new Date().toISOString(), ...patch, error_message: patch.error_message?.slice(0, 1000) ?? null })
        .eq("id", run.id);
    };

    try {
      const sender = await options.resolveSender(automation.agency_id);
      if (!sender) { await finish("skipped", { error_message: NOT_CONNECTED }); continue; }

      const [{ data: targets }, { data: client }, { data: agency }] = await Promise.all([
        service.from("report_automation_targets").select("recipient_id,group_id,group_name").eq("automation_id", automation.id).eq("agency_id", automation.agency_id),
        service.from("clients").select("name,archived_at").eq("id", automation.client_id).eq("agency_id", automation.agency_id).maybeSingle(),
        service.from("agencies").select("name").eq("id", automation.agency_id).maybeSingle(),
      ]);
      if (!client || client.archived_at) { await finish("skipped", { error_message: "Cliente arquivado ou removido." }); continue; }
      const recipientIds = (targets ?? []).flatMap(target => target.recipient_id ? [target.recipient_id] : []);
      const { data: recipients } = recipientIds.length
        ? await service.from("client_recipients").select("id,name,phone,active,consent_status,unsubscribed_at").eq("agency_id", automation.agency_id).in("id", recipientIds)
        : { data: [] };
      // Consent is checked again at send time: a recipient may have opted out since the schedule was saved.
      const people = (recipients ?? []).filter(row => row.active && !row.unsubscribed_at && row.consent_status === "granted");
      const groups = (targets ?? []).flatMap(target => target.group_id ? [{ id: target.group_id, name: target.group_name ?? "Grupo" }] : []);
      if (!people.length && !groups.length) { await finish("skipped", { error_message: "Nenhum destinatário autorizado." }); continue; }

      const { data: payload, error: analyticsError } = await service.rpc("service_client_analytics", {
        p_client_id: automation.client_id, p_date_from: plan.period.dateFrom, p_date_to: plan.period.dateTo,
      });
      if (analyticsError || !payload) { await finish("failed", { error_message: "Não foi possível ler os números do período." }); continue; }
      const data = normalizeClientAnalytics(payload);
      const context = { clientName: client.name, workspaceName: agency?.name ?? null, data, dashboardUrl: options.appUrl ? `${options.appUrl}/cliente/${automation.client_id}` : null };

      let sent = 0; let failed = 0; const errors: string[] = [];
      // Each person gets their own first name; a group gets the version without a name.
      const deliveries: Array<{ destination: MessageDestination; text: string }> = [
        ...people.map(person => ({ destination: { kind: "phone" as const, phone: person.phone, label: person.name }, text: renderMessage(automation.message_template, { ...context, recipientName: person.name }) })),
        ...groups.map(group => ({ destination: { kind: "group" as const, groupId: group.id, label: group.name }, text: renderMessage(automation.message_template, { ...context, recipientName: "pessoal" }) })),
      ];
      for (const [index, item] of deliveries.entries()) {
        const report = await deliverToDestinations(sender, [item.destination], item.text, options.pause);
        sent += report.sent; failed += report.failed; errors.push(...report.errors);
        if (index < deliveries.length - 1) await new Promise(resolve => setTimeout(resolve, options.pause?.() ?? 4000 + Math.random() * 5000));
      }
      await finish(runStatus({ sent, failed, errors }), { message_text: deliveries[0].text.slice(0, 6000), sent_count: sent, failed_count: failed, error_message: errors.join(" · ") || null });
    } catch {
      await finish("failed", { error_message: "Erro inesperado ao executar o agendamento." });
    }
  }
  return summary;
}
