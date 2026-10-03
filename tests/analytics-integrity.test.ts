import { describe, expect, it } from "vitest";
import { normalizeClientAnalytics } from "@/modules/client-portal/analytics-calculations";

const base = {
  dateFrom: "2026-09-03",
  dateTo: "2026-10-02",
  previousDateFrom: "2026-08-04",
  previousDateTo: "2026-09-02",
  currency: "BRL",
  timezoneName: "America/Sao_Paulo",
  selectedAccountIds: ["account-1"],
  accounts: [{ id: "account-1", name: "Conta", externalId: "act_1", timezoneName: "America/Sao_Paulo", currency: "BRL" }],
  metrics: [{ key: "spend", label: "Valor usado", unit: "currency", precision: 2, desirable: "neutral" }],
  summary: { spend: 100, impressions: 1000 },
  previousSummary: { spend: 90 },
  daily: [{ date: "2026-09-03", values: { spend: 10, impressions: 100 } }],
  previousDaily: [{ date: "2026-08-04", values: { spend: 9 } }],
  accountTotals: [{ id: "account-1", name: "Conta", currency: "BRL", values: { spend: 100 } }],
  campaigns: [{ id: "1", name: "Campanha", accountId: "account-1", accountName: "Conta", currency: "BRL", status: "ACTIVE", values: { spend: 100 } }],
};

describe("analytics integrity barrier", () => {
  it("removes all current numeric values when current coverage is partial", () => {
    const data = normalizeClientAnalytics({
      ...base,
      coverage: {
        status: "partial",
        previousStatus: "complete",
        latestCollectedAt: "2026-10-03T12:00:00Z",
        coveredDays: 7,
        previousCoveredDays: 30,
        totalDays: 30,
      },
    });
    expect(data.coverage.status).toBe("partial");
    expect(data.summary).toEqual({});
    expect(data.daily[0]?.values).toEqual({});
    expect(data.accountTotals[0]?.values).toEqual({});
    expect(data.campaigns[0]?.values).toEqual({});
    expect(data.previousSummary.spend).toBe(90);
  });

  it("removes comparison values independently when only previous coverage is partial", () => {
    const data = normalizeClientAnalytics({
      ...base,
      coverage: {
        status: "complete",
        previousStatus: "partial",
        latestCollectedAt: "2026-10-03T12:00:00Z",
        coveredDays: 30,
        previousCoveredDays: 7,
        totalDays: 30,
      },
    });
    expect(data.summary.spend).toBe(100);
    expect(data.daily[0]?.values.spend).toBe(10);
    expect(data.previousSummary).toEqual({});
    expect(data.previousDaily[0]?.values).toEqual({});
  });

  it("preserves values when coverage is complete", () => {
    const data = normalizeClientAnalytics({
      ...base,
      coverage: {
        status: "complete",
        previousStatus: "complete",
        latestCollectedAt: "2026-10-03T12:00:00Z",
        coveredDays: 30,
        previousCoveredDays: 30,
        totalDays: 30,
      },
    });
    expect(data.summary.spend).toBe(100);
    expect(data.accountTotals[0]?.values.spend).toBe(100);
    expect(data.campaigns[0]?.values.spend).toBe(100);
  });
});
