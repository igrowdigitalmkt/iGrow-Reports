export type AdminReportVersion = {
  id: string;
  reportId: string;
  clientId: string;
  clientName: string;
  title: string;
  versionNumber: number;
  dateFrom: string;
  dateTo: string;
  currency: string | null;
  state: "ready" | "published" | "superseded";
  dataCollectedAt: string | null;
  generatedAt: string;
  publishedAt: string | null;
};

export type ReportsAdminSnapshot = {
  ready: boolean;
  versions: AdminReportVersion[];
};

export type ClientPortalReport = {
  reportVersionId: string;
  reportId: string;
  title: string;
  versionNumber: number;
  dateFrom: string;
  dateTo: string;
  currency: string | null;
  timezoneName: string | null;
  dataCollectedAt: string | null;
  publishedAt: string | null;
};

export type ClientPortalReportMetric = {
  metricKey: string;
  label: string;
  unit: "currency" | "integer" | "percent" | "ratio";
  numericValue: number | null;
  displayPrecision: number;
};
