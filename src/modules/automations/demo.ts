import type { ClientItem } from "@/modules/clients/schema";
import type { SendableRecipient } from "@/modules/whatsapp/send-report-dialog";
import { MESSAGE_PRESETS } from "./message";
import type { AutomationsSnapshot } from "./types";

// Fictitious schedules for the demo workspace. Never written to the database.
const updated = "2026-10-01T12:00:00.000Z";
export const demoAutomationClients: ClientItem[] = [
  { id: "d0000000-0000-4000-8000-000000000001", name: "Escola Horizonte", notes: null, archived_at: null, updated_at: updated },
  { id: "d0000000-0000-4000-8000-000000000002", name: "Órbita Fit", notes: null, archived_at: null, updated_at: updated },
  { id: "d0000000-0000-4000-8000-000000000003", name: "Aurora Studio", notes: null, archived_at: null, updated_at: updated },
];

export const demoAutomationRecipients: SendableRecipient[] = [
  { id: "d1000000-0000-4000-8000-000000000001", clientId: demoAutomationClients[0].id, name: "Mariana Costa", phone: "+55 11 98888-1020", authorized: true, reason: null },
  { id: "d1000000-0000-4000-8000-000000000002", clientId: demoAutomationClients[0].id, name: "Paulo Henrique", phone: "+55 11 97777-3040", authorized: true, reason: null },
  { id: "d1000000-0000-4000-8000-000000000003", clientId: demoAutomationClients[0].id, name: "Financeiro", phone: "+55 11 96666-5060", authorized: false, reason: "sem autorização de recebimento" },
  { id: "d1000000-0000-4000-8000-000000000004", clientId: demoAutomationClients[1].id, name: "Rafael Lima", phone: "+55 21 98123-4567", authorized: true, reason: null },
];

export const demoAutomations: AutomationsSnapshot = {
  ready: true,
  automations: [
    {
      id: "d2000000-0000-4000-8000-000000000001", clientId: demoAutomationClients[0].id, name: "Resumo de segunda", messageTemplate: MESSAGE_PRESETS[0].text,
      periodKey: "last_7d", frequency: "weekly", weekdays: [1], monthDay: 1, sendTime: "08:30", timezone: "America/Sao_Paulo", active: true,
      nextRunAt: null, lastRunAt: null, targets: [{ recipientId: demoAutomationRecipients[0].id }, { groupId: "120363000000000001@g.us", groupName: "Escola Horizonte · Marketing" }],
    },
    {
      id: "d2000000-0000-4000-8000-000000000002", clientId: demoAutomationClients[1].id, name: "Parcial diária", messageTemplate: MESSAGE_PRESETS[1].text,
      periodKey: "yesterday", frequency: "weekly", weekdays: [1, 2, 3, 4, 5], monthDay: 1, sendTime: "09:00", timezone: "America/Sao_Paulo", active: true,
      nextRunAt: null, lastRunAt: null, targets: [{ recipientId: demoAutomationRecipients[3].id }],
    },
    {
      id: "d2000000-0000-4000-8000-000000000003", clientId: demoAutomationClients[2].id, name: "Fechamento do mês", messageTemplate: MESSAGE_PRESETS[2].text,
      periodKey: "last_month", frequency: "monthly", weekdays: [1], monthDay: 2, sendTime: "10:00", timezone: "America/Sao_Paulo", active: false,
      nextRunAt: null, lastRunAt: null, targets: [{ groupId: "120363000000000002@g.us", groupName: "Aurora · Diretoria" }],
    },
  ],
  runs: [
    { id: "d3000000-0000-4000-8000-000000000001", automationId: "d2000000-0000-4000-8000-000000000002", scheduledFor: "2026-10-06T12:00:00.000Z", status: "sent", dateFrom: "2026-10-05", dateTo: "2026-10-05", sentCount: 1, failedCount: 0, errorMessage: null, messageText: null },
    { id: "d3000000-0000-4000-8000-000000000002", automationId: "d2000000-0000-4000-8000-000000000001", scheduledFor: "2026-10-05T11:30:00.000Z", status: "partial", dateFrom: "2026-09-28", dateTo: "2026-10-04", sentCount: 1, failedCount: 1, errorMessage: "Um número não tem WhatsApp.", messageText: null },
    { id: "d3000000-0000-4000-8000-000000000003", automationId: "d2000000-0000-4000-8000-000000000002", scheduledFor: "2026-10-05T12:00:00.000Z", status: "sent", dateFrom: "2026-10-04", dateTo: "2026-10-04", sentCount: 1, failedCount: 0, errorMessage: null, messageText: null },
  ],
};
