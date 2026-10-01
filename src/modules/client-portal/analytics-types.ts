export type AnalyticsValues = Record<string, number | null>;

export type AnalyticsMetric = {
  key: string;
  label: string;
  unit: "currency" | "integer" | "percent" | "ratio";
  precision: number;
  desirable: "up" | "down" | "neutral";
};

export type AnalyticsAccount = {
  id: string;
  name: string;
  externalId: string;
  timezoneName: string;
  currency: string;
};

export type AnalyticsReportItem = {
  reportVersionId: string;
  reportId: string;
  title: string;
  versionNumber: number;
  dateFrom: string;
  dateTo: string;
  state: "ready" | "published" | "superseded";
  publishedAt: string | null;
};

export type AnalyticsDashboardData = {
  dateFrom: string;
  dateTo: string;
  previousDateFrom: string;
  previousDateTo: string;
  currency: string | null;
  timezoneName: string | null;
  primaryMetricKey: string | null;
  primaryActionType: string | null;
  accounts: AnalyticsAccount[];
  selectedAccountIds: string[];
  summary: AnalyticsValues;
  previousSummary: AnalyticsValues;
  daily: Array<{ date: string; values: AnalyticsValues }>;
  previousDaily: Array<{ date: string; values: AnalyticsValues }>;
  accountTotals: Array<{ id: string; name: string; currency: string; values: AnalyticsValues }>;
  campaigns: Array<{
    id: string;
    name: string;
    accountName: string;
    accountId: string;
    currency: string;
    status: string | null;
    values: AnalyticsValues;
  }>;
  metrics: AnalyticsMetric[];
  coverage: {
    status: "complete" | "partial" | "empty";
    previousStatus: "complete" | "partial" | "empty";
    latestCollectedAt: string | null;
    coveredDays: number;
    previousCoveredDays: number;
    totalDays: number;
  };
  warnings: string[];
};
