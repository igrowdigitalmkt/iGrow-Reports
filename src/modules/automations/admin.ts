import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AutomationItem, AutomationsSnapshot, AutomationTarget } from "./types";

// Reads under the user's RLS. Before the automations migration is applied the tables do not
// exist: the page then explains that the feature still needs to be installed.
export async function loadAutomations(supabase: SupabaseClient<Database>, agencyId: string): Promise<AutomationsSnapshot> {
  const { data, error } = await supabase.from("report_automations").select("*").eq("agency_id", agencyId).order("created_at");
  if (error || !data) return { ready: false, automations: [], runs: [] };
  const [{ data: targets }, { data: runs }] = await Promise.all([
    supabase.from("report_automation_targets").select("automation_id,recipient_id,group_id,group_name").eq("agency_id", agencyId),
    supabase.from("report_automation_runs").select("*").eq("agency_id", agencyId).order("scheduled_for", { ascending: false }).limit(100),
  ]);
  const automations: AutomationItem[] = data.map(row => ({
    id: row.id, clientId: row.client_id, name: row.name, messageTemplate: row.message_template, periodKey: row.period_key,
    frequency: row.frequency, weekdays: row.weekdays, monthDay: row.month_day, sendTime: row.send_time.slice(0, 5), timezone: row.timezone,
    active: row.active, nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
    targets: (targets ?? []).filter(target => target.automation_id === row.id).map((target): AutomationTarget => target.recipient_id
      ? { recipientId: target.recipient_id } : { groupId: target.group_id ?? "", groupName: target.group_name ?? "Grupo" }),
  }));
  return {
    ready: true, automations,
    runs: (runs ?? []).map(run => ({
      id: run.id, automationId: run.automation_id, scheduledFor: run.scheduled_for, status: run.status, dateFrom: run.date_from, dateTo: run.date_to,
      sentCount: run.sent_count, failedCount: run.failed_count, errorMessage: run.error_message, messageText: run.message_text, trigger: run.trigger ?? "schedule",
    })),
  };
}
