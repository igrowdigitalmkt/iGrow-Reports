import type { AnalyticsDashboardData } from "./analytics-types";

type AnalyticsMetric = AnalyticsDashboardData["metrics"][number];

// Shared by the dashboard (browser) and the PDF built on the server for scheduled sends.
export function formatAnalyticsValue(value: number | null | undefined, metric: AnalyticsMetric, currency: string | null) {
  if (value == null || !Number.isFinite(value)) return "Indisponível";
  if (metric.unit === "currency" && !currency) return "Indisponível";
  try {
    const number = new Intl.NumberFormat("pt-BR", {
      ...(metric.unit === "currency" ? { style: "currency", currency: currency! } : {}),
      minimumFractionDigits: metric.precision,
      maximumFractionDigits: metric.precision,
    }).format(value);
    return metric.unit === "percent" ? `${number}%` : number;
  } catch {
    return "Indisponível";
  }
}
