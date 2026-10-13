import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";
import { generateWhatsAppSummary } from "@/modules/ai/whatsapp-summary";
import type { GuardedResult } from "@/modules/ai/guarded-text";
import type { Database, ReportAutomationRow, ReportAutomationRunRow } from "@/types/database";
import { renderMessage, renderSeparatedMessage, usedVariables, type AccountBlock } from "./message";
import { summarizeBalance } from "@/modules/meta/balance";
import { getClientAccountBilling, refreshMetaDashboardScope } from "@/modules/meta/server";
import { localDate, nextRunAt, resolvePeriod } from "./schedule";
import { deliverToDestinations, runStatus, type MessageDestination, type MessageSender } from "./sender";

type Service = SupabaseClient<Database>;
export type SenderResolver = (agencyId: string) => Promise<MessageSender | null>;
type Recipient = { id: string; name: string; phone: string; active: boolean; consent_status: string; unsubscribed_at: string | null };
/** Official number: the period PDF with the number's approved template, one delivery per person. */
export type OfficialPdfSender = (input: {
  agencyId: string; connectionId: string; clientId: string; clientName: string; workspaceName: string; runId: string;
  data: ReturnType<typeof normalizeClientAnalytics>; recipients: Recipient[];
}) => Promise<{ results: Array<{ name: string; status: "accepted" | "failed" | "skipped"; message?: string }>; summary: string }>;

const NOT_CONNECTED = "WhatsApp não conectado por QR Code. Conecte seu número em Integrações para ativar os envios.";
const NO_OFFICIAL_NUMBER = "O número oficial deste agendamento foi removido. Escolha outro número no agendamento.";

/** Period, local run date and the following slot for one due automation. */
export function planRun(automation: Pick<ReportAutomationRow, "frequency" | "weekdays" | "month_day" | "send_time" | "timezone" | "period_key" | "next_run_at">, now: Date) {
  const scheduledFor = new Date(automation.next_run_at ?? now.toISOString());
  const runDate = localDate(scheduledFor, automation.timezone);
  const rule = { frequency: automation.frequency, weekdays: automation.weekdays, monthDay: automation.month_day, sendTime: automation.send_time.slice(0, 5), timezone: automation.timezone };
  // Missed slots (server off, long outage) are not replayed: the next one is in the future.
  const after = scheduledFor.getTime() > now.getTime() ? scheduledFor : now;
  return { scheduledFor, period: resolvePeriod(automation.period_key, runDate), next: nextRunAt(rule, after) };
}

export type RunOutcome = { status: "sent" | "partial" | "failed" | "skipped" | "awaiting_approval"; sent: number; failed: number; message: string | null; runId: string | null };
type AnalyticsData = ReturnType<typeof normalizeClientAnalytics>;
export type SummaryGenerator = (input: { agencyId: string; clientId: string; data: AnalyticsData; accounts?: Array<{ id: string; name: string; data: AnalyticsData }> }) => Promise<GuardedResult>;
export type ExecuteOptions = {
  resolveSender: SenderResolver; sendOfficialPdf?: OfficialPdfSender; pause?: () => number; appUrl?: string | null;
  /** Escreve a análise de {{analise_ia}}; sem ele usa a IA real. */
  generateSummary?: SummaryGenerator;
  /** Envio de uma execução que estava aguardando aprovação, com o texto aprovado (já revisado) pelo responsável. */
  approval?: { runId: string; aiText: string };
};

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
  let row: { id: string } | null = null;
  if (options.approval) {
    // Aprovação: a execução já existe. A troca condicional de status é a trava contra duplo envio (duplo clique, duas abas).
    const { data: taken } = await service.from("report_automation_runs")
      .update({ status: "running", ai_text: options.approval.aiText })
      .eq("id", options.approval.runId).eq("agency_id", automation.agency_id).eq("automation_id", automation.id).eq("status", "awaiting_approval")
      .select("id").maybeSingle();
    row = taken;
  } else {
    let claim = await service.from("report_automation_runs").insert(payload).select("id").single();
    if (claim.error?.code === "PGRST204" && run.trigger === "manual") claim = await service.from("report_automation_runs").insert(base).select("id").single();
    if (!claim.error) row = claim.data;
  }
  if (!row) return null;
  const runId = row.id;

  const finish = async (status: RunOutcome["status"], patch: { message_text?: string; sent_count?: number; failed_count?: number; error_message?: string | null }): Promise<RunOutcome> => {
    const message = patch.error_message?.slice(0, 1000) ?? null;
    await service.from("report_automation_runs").update({ status, finished_at: new Date().toISOString(), ...patch, error_message: message }).eq("id", runId);
    return { status, sent: patch.sent_count ?? 0, failed: patch.failed_count ?? 0, message, runId };
  };

  try {
    const official = automation.sender === "official";
    if (official && !automation.whatsapp_connection_id) return await finish("skipped", { error_message: NO_OFFICIAL_NUMBER });
    if (official && !options.sendOfficialPdf) return await finish("skipped", { error_message: "Envio pela API oficial indisponível neste ambiente." });
    const sender = official ? null : await options.resolveSender(automation.agency_id);
    if (!official && !sender) return await finish("skipped", { error_message: NOT_CONNECTED });

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
    // The official API sends to people only; groups are a QR Code feature.
    const groups = official ? [] : (targets ?? []).flatMap(target => target.group_id ? [{ id: target.group_id, name: target.group_name ?? "Grupo" }] : []);
    if (!people.length && !groups.length) return await finish("skipped", { error_message: official ? "Nenhuma pessoa autorizada. Grupos não recebem pela API oficial." : "Nenhum destinatário autorizado." });

    const { data: payload, error: analyticsError } = await service.rpc("service_client_analytics", {
      p_client_id: automation.client_id, p_date_from: run.period.dateFrom, p_date_to: run.period.dateTo,
    });
    if (analyticsError || !payload) return await finish("failed", { error_message: "Não foi possível ler os números do período." });
    let data = normalizeClientAnalytics(payload);
    if (official) {
      const outcome = await options.sendOfficialPdf!({
        agencyId: automation.agency_id, connectionId: automation.whatsapp_connection_id!, clientId: automation.client_id,
        clientName: client.name, workspaceName: agency?.name ?? "", runId, data, recipients: people,
      });
      const sentCount = outcome.results.filter(item => item.status === "accepted").length;
      const failures = outcome.results.filter(item => item.status === "failed").map(item => `${item.name}: ${item.message ?? "falhou"}`);
      return await finish(sentCount || failures.length ? runStatus({ sent: sentCount, failed: failures.length }) : "skipped", { message_text: outcome.summary.slice(0, 6000), sent_count: sentCount, failed_count: failures.length, error_message: failures.join(" · ") || null });
    }
    // Contas separadas (padrão): cada conta de anúncios com os próprios números. Consolidar soma tudo como uma conta só.
    let perAccount: Array<{ id: string; name: string; data: AnalyticsData }> | null = null;
    if (!automation.consolidate_accounts && data.accounts.length > 1) {
      const loaded = await Promise.all(data.accounts.map(async account => {
        const { data: accountPayload, error } = await service.rpc("service_client_analytics_accounts", {
          p_client_id: automation.client_id, p_date_from: run.period.dateFrom, p_date_to: run.period.dateTo, p_account_ids: [account.id],
        });
        return error || !accountPayload ? null : { id: account.id, name: account.name, data: normalizeClientAnalytics(accountPayload) };
      }));
      if (loaded.some(item => !item)) return await finish("failed", { error_message: "Não foi possível ler os números de uma das contas do cliente." });
      perAccount = loaded.filter(item => item !== null);
    }
    // A análise da IA só usa números confirmados pela Meta para o recorte exato (cada conta, ou todas somadas).
    // Sem agregado confirmado, o envio pede a confirmação à Meta aqui mesmo antes de gerar o texto.
    if (!options.approval && !options.generateSummary && usedVariables(automation.message_template).includes("analise_ia")) {
      const confirm = async (part: AnalyticsData, accountIds: string[] | null): Promise<AnalyticsData> => {
        if (part.metaAggregate?.confirmed || part.coverage.status !== "complete") return part;
        try {
          await refreshMetaDashboardScope({ agencyId: automation.agency_id, clientId: automation.client_id, data: part });
          const { data: again } = accountIds
            ? await service.rpc("service_client_analytics_accounts", { p_client_id: automation.client_id, p_date_from: run.period.dateFrom, p_date_to: run.period.dateTo, p_account_ids: accountIds })
            : await service.rpc("service_client_analytics", { p_client_id: automation.client_id, p_date_from: run.period.dateFrom, p_date_to: run.period.dateTo });
          return again ? normalizeClientAnalytics(again) : part;
        } catch { return part; }
      };
      if (perAccount) perAccount = await Promise.all(perAccount.map(async account => ({ ...account, data: await confirm(account.data, [account.id]) })));
      else data = await confirm(data, null);
    }
    // The balance is read live from Meta only when the message shows it.
    const billing = usedVariables(automation.message_template).includes("saldo")
      ? await getClientAccountBilling({ agencyId: automation.agency_id, clientId: automation.client_id }).catch(() => null) : null;
    const balance = billing ? summarizeBalance(billing) : null;
    const blocks: AccountBlock[] | null = perAccount && perAccount.map(account => ({
      name: account.name, data: account.data, balance: billing ? summarizeBalance(billing.filter(item => item.accountId === account.id)) : null,
    }));
    const dashboardUrl = options.appUrl ? `${options.appUrl}/cliente/${automation.client_id}` : null;
    const compose = (recipientName: string, aiText: string | null) => blocks
      ? renderSeparatedMessage(automation.message_template, { clientName: client.name, workspaceName: agency?.name ?? null, aiText, dashboardUrl, recipientName }, blocks)
      : renderMessage(automation.message_template, { clientName: client.name, workspaceName: agency?.name ?? null, data, balance, aiText, dashboardUrl, recipientName });
    const aiText: string | null = options.approval?.aiText ?? null;
    if (!aiText && usedVariables(automation.message_template).includes("analise_ia")) {
      // A IA escreve uma vez por execução e nada sai antes de o responsável aprovar o texto.
      const generate: SummaryGenerator = options.generateSummary ?? (input => generateWhatsAppSummary({ ...input, service }));
      const written = await generate({ agencyId: automation.agency_id, clientId: automation.client_id, data, ...(perAccount ? { accounts: perAccount } : {}) });
      if (!written.ok) return await finish("failed", { error_message: `Análise com IA indisponível: ${written.message}` });
      const preview = compose(people[0]?.name ?? "pessoal", written.text);
      await service.from("report_automation_runs").update({ status: "awaiting_approval", ai_text: written.text, message_text: preview.slice(0, 6000), error_message: null }).eq("id", runId);
      return { status: "awaiting_approval", sent: 0, failed: 0, message: null, runId };
    }
    let sent = 0; let failed = 0; const errors: string[] = [];
    const recipientIdOf = new Map(people.map(person => [person.phone, person.id]));
    // Each person gets their own first name; a group gets the version without a name.
    const deliveries: Array<{ destination: MessageDestination; text: string }> = [
      ...people.map(person => ({ destination: { kind: "phone" as const, phone: person.phone, label: person.name }, text: compose(person.name, aiText) })),
      ...groups.map(group => ({ destination: { kind: "group" as const, groupId: group.id, label: group.name }, text: compose("pessoal", aiText) })),
    ];
    for (const [index, item] of deliveries.entries()) {
      const report = await deliverToDestinations(sender!, [item.destination], item.text, options.pause);
      sent += report.sent; failed += report.failed; errors.push(...report.errors);
      // Best effort: without migration 202610070006 the send still counts, only receipts are missing.
      await service.from("automation_messages").insert(report.details.map(detail => ({
        agency_id: automation.agency_id, run_id: runId, automation_id: automation.id, client_id: automation.client_id,
        recipient_id: detail.destination.kind === "phone" ? recipientIdOf.get(detail.destination.phone) ?? null : null,
        group_id: detail.destination.kind === "group" ? detail.destination.groupId : null,
        destination_label: detail.destination.label.slice(0, 200), message_id: detail.messageId,
        status: detail.ok ? "sent" : "failed", error_message: detail.error?.slice(0, 500) ?? null,
      }))).then(() => undefined, () => undefined);
      if (index < deliveries.length - 1) await new Promise(resolve => setTimeout(resolve, options.pause?.() ?? 4000 + Math.random() * 5000));
    }
    return await finish(runStatus({ sent, failed, errors }), { message_text: deliveries[0].text.slice(0, 6000), sent_count: sent, failed_count: failed, error_message: errors.join(" · ") || null });
  } catch (error) {
    // Setup problems (template not approved, PDF without complete data) explain themselves.
    const known = error instanceof Error && (error.name === "WhatsAppSetupError" || error.name === "PeriodPdfUnavailableError");
    return await finish("failed", { error_message: known ? (error as Error).message : "Erro inesperado ao executar o agendamento." });
  }
}

export async function runDueAutomations(service: Service, options: ExecuteOptions & { now?: Date; budgetMs?: number }) {
  const now = options.now ?? new Date();
  const started = Date.now();
  const budget = options.budgetMs ?? 240_000;
  const { data: due, error } = await service.from("report_automations").select("*").eq("active", true).lte("next_run_at", now.toISOString())
    .order("next_run_at").limit(25);
  if (error) throw new Error("automations-list-failed");
  const summary = { due: due?.length ?? 0, sent: 0, partial: 0, failed: 0, skipped: 0, awaiting_approval: 0, deferred: 0 };

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
