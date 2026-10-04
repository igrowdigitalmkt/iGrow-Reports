import { describe, expect, it } from "vitest";
import { hasConfirmedAnalytics } from "@/modules/client-portal/analytics-readiness";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";

describe("atomic dashboard readiness", () => {
  it.each([
    ["complete", undefined, false],
    ["complete", false, false],
    ["partial", true, false],
    ["empty", true, false],
    ["complete", true, true],
  ] as const)("coverage %s and confirmation %s yields %s", (status, confirmed, expected) => {
    const data = { coverage: { status }, metaAggregate: confirmed === undefined ? undefined
      : { confirmed, collectedAt: null, version: null } } as Pick<AnalyticsDashboardData, "coverage" | "metaAggregate">;
    expect(hasConfirmedAnalytics(data)).toBe(expected);
  });
});
