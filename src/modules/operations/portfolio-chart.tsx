"use client";

import { AnalyticsTrendChart } from "@/modules/client-portal/analytics-charts";
import type { AnalyticsDashboardData, AnalyticsMetric } from "@/modules/client-portal/analytics-types";

const SPEND: AnalyticsMetric = { key: "spend", label: "Investimento", unit: "currency", precision: 2, desirable: "neutral" };

// Daily spend of the whole portfolio in the same chart as the client dashboard, with the previous period dashed.
export function PortfolioSpendChart({ days, spend, previous, currency }: { days: string[]; spend: number[]; previous: number[]; currency: string | null }) {
  const data = {
    dateFrom: days[0] ?? "", dateTo: days.at(-1) ?? "", currency,
    daily: days.map((date, index) => ({ date, values: { spend: spend[index] ?? null } })),
    previousDaily: previous.map((value, index) => ({ date: days[index] ?? "", values: { spend: value } })),
    coverage: { status: "complete", previousStatus: previous.length === days.length && previous.length > 0 ? "complete" : "empty", latestCollectedAt: null, coveredDays: days.length, previousCoveredDays: previous.length, totalDays: days.length },
  } as unknown as AnalyticsDashboardData;
  if (!days.length) return <div className="overview-chart-empty">Sem investimento no período.</div>;
  return <AnalyticsTrendChart data={data} metrics={[SPEND]} chartType="bar" height={220} />;
}
