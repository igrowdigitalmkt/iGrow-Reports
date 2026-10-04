import { aggregateResults } from "./analytics-results";
import type { AnalyticsDashboardData, AnalyticsMetric, AnalyticsValues } from "./analytics-types";
import { metaMetricLabel } from "@/modules/meta/metric-labels";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return text(value) || null;
}

export function analyticsNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeAnalyticsValues(value: unknown): AnalyticsValues {
  return Object.fromEntries(Object.entries(object(value)).map(([key, amount]) => [key, analyticsNumber(amount)]));
}

function coverageStatus(value: unknown): "complete" | "partial" | "empty" {
  return value === "complete" || value === "partial" ? value : "empty";
}

function zeroDeliveryValues(values: AnalyticsValues) {
  const spend = values.spend;
  const impressions = values.impressions;
  if (spend !== 0 || (impressions != null && impressions !== 0)) return values;
  return aggregateResults({ ...values, "result:provider_known": 1 }, true);
}

function reconcileCampaignResults(data: AnalyticsDashboardData): AnalyticsDashboardData {
  if (data.coverage.status !== "complete" || data.summary.spend == null || !Number.isFinite(data.summary.spend)
    || data.summary.spend < 0 || !data.campaigns.length) return data;

  const campaigns = data.campaigns.map((campaign) => ({ ...campaign, values: zeroDeliveryValues(campaign.values) }));
  let sourceSpend = 0;
  const providerTotals: AnalyticsValues = {};
  for (const campaign of campaigns) {
    const spend = campaign.values.spend;
    if (spend == null || !Number.isFinite(spend) || spend < 0) return { ...data, campaigns };
    sourceSpend += spend;
    if (campaign.values["result:provider_known"] !== 1) return { ...data, campaigns };
    for (const [key, amount] of Object.entries(campaign.values)) {
      if (!key.startsWith("result:provider:")) continue;
      if (amount == null || !Number.isFinite(amount) || amount < 0) return { ...data, campaigns };
      providerTotals[key] = (providerTotals[key] ?? 0) + amount;
    }
  }

  if (Math.abs(sourceSpend - data.summary.spend) > Math.max(.005, Math.abs(data.summary.spend) * 1e-10)) {
    return { ...data, campaigns };
  }

  const summary = Object.fromEntries(Object.entries(data.summary)
    .filter(([key]) => !key.startsWith("result:provider:") && key !== "result:provider_known"));
  return {
    ...data,
    campaigns,
    summary: aggregateResults({ ...summary, ...providerTotals, "result:provider_known": 1 }, true),
  };
}

export function normalizeClientAnalytics(value: unknown, automaticResults = true): AnalyticsDashboardData {
  const payload = object(value);
  const coverage = object(payload.coverage);
  const metaAggregate = object(payload.metaAggregate);
  const currentComplete = coverageStatus(coverage.status) === "complete";
  const previousComplete = coverageStatus(coverage.previousStatus) === "complete";
  const liveValues = (input: unknown, complete: boolean) => {
    const normalized = normalizeAnalyticsValues(input);
    if (automaticResults && !complete) return {};
    return automaticResults ? aggregateResults(normalized, true) : normalized;
  };
  const series = (input: unknown, complete: boolean) => array(input).map((entry) => {
    const row = object(entry);
    return { date: text(row.date), values: liveValues(row.values, complete) };
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));

  const metrics: AnalyticsMetric[] = array(payload.metrics).map((entry) => {
    const row = object(entry);
    return {
      key: text(row.key), label: metaMetricLabel(text(row.key), text(row.label)),
      unit: (row.unit === "currency" || row.unit === "percent" || row.unit === "ratio" ? row.unit : "integer") as AnalyticsMetric["unit"],
      precision: Math.max(0, Math.min(6, analyticsNumber(row.precision) ?? 0)),
      desirable: (row.desirable === "up" || row.desirable === "down" ? row.desirable : "neutral") as AnalyticsMetric["desirable"],
    };
  }).filter((row) => row.key && row.label);

  const normalized: AnalyticsDashboardData = {
    dateFrom: text(payload.dateFrom), dateTo: text(payload.dateTo),
    previousDateFrom: text(payload.previousDateFrom), previousDateTo: text(payload.previousDateTo),
    currency: nullableText(payload.currency), timezoneName: nullableText(payload.timezoneName),
    primaryMetricKey: nullableText(payload.primaryMetricKey), primaryActionType: nullableText(payload.primaryActionType),
    accounts: array(payload.accounts).map((entry) => {
      const row = object(entry);
      return { id: text(row.id), name: text(row.name), externalId: text(row.externalId), timezoneName: text(row.timezoneName), currency: text(row.currency) };
    }),
    selectedAccountIds: array(payload.selectedAccountIds).map(text).filter(Boolean),
    summary: liveValues(payload.summary, currentComplete), previousSummary: liveValues(payload.previousSummary, previousComplete),
    daily: series(payload.daily, currentComplete), previousDaily: series(payload.previousDaily, previousComplete),
    accountTotals: array(payload.accountTotals).map((entry) => {
      const row = object(entry);
      return { id: text(row.id), name: text(row.name), currency: text(row.currency), values: liveValues(row.values, currentComplete) };
    }),
    campaigns: array(payload.campaigns).map((entry) => {
      const row = object(entry);
      return {
        id: text(row.id), name: text(row.name), accountName: text(row.accountName), accountId: text(row.accountId),
        currency: text(row.currency), status: nullableText(row.status), values: liveValues(row.values, currentComplete),
      };
    }),
    metrics,
    coverage: {
      status: coverageStatus(coverage.status), previousStatus: coverageStatus(coverage.previousStatus),
      latestCollectedAt: nullableText(coverage.latestCollectedAt),
      coveredDays: analyticsNumber(coverage.coveredDays) ?? 0,
      previousCoveredDays: analyticsNumber(coverage.previousCoveredDays) ?? 0,
      totalDays: analyticsNumber(coverage.totalDays) ?? 0,
    },
    warnings: array(payload.warnings).map(text).filter(Boolean),
    estimatedMetricKeys: array(payload.estimatedMetricKeys).map(text).filter(Boolean),
    metaAggregate: { confirmed: metaAggregate.confirmed === true,
      collectedAt: nullableText(metaAggregate.collectedAt), version: analyticsNumber(metaAggregate.version) },
  };
  return automaticResults ? reconcileCampaignResults(normalized) : normalized;
}
