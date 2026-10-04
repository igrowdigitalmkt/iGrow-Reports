import type { AnalyticsDashboardData } from "./analytics-types";

// Daily coverage alone does not confirm the exact period aggregate.
export function hasConfirmedAnalytics(data: Pick<AnalyticsDashboardData, "coverage" | "metaAggregate">) {
  return data.coverage.status === "complete" && data.metaAggregate?.confirmed === true;
}
