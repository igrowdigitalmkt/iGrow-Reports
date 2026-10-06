import type { ReportAutomationRunStatus, ReportFrequency, ReportPeriodKey } from "@/types/database";

export type AutomationTarget = { recipientId: string; groupId?: undefined; groupName?: undefined } | { recipientId?: undefined; groupId: string; groupName: string };

export type AutomationItem = {
  id: string;
  clientId: string;
  name: string;
  messageTemplate: string;
  periodKey: ReportPeriodKey;
  frequency: ReportFrequency;
  weekdays: number[];
  monthDay: number;
  sendTime: string;
  timezone: string;
  active: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  targets: AutomationTarget[];
};

export type AutomationRunItem = {
  id: string;
  automationId: string;
  scheduledFor: string;
  status: ReportAutomationRunStatus;
  dateFrom: string | null;
  dateTo: string | null;
  sentCount: number;
  failedCount: number;
  errorMessage: string | null;
  messageText: string | null;
  trigger: "schedule" | "manual";
};

export type AutomationsSnapshot = { ready: boolean; automations: AutomationItem[]; runs: AutomationRunItem[] };
