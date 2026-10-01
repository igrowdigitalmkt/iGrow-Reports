import { describe, expect, it } from "vitest";
import { resolveAnalyticsRange } from "../src/modules/client-portal/range";

describe("dashboard date ranges", () => {
  it("uses complete days in the account timezone", () => {
    const now = new Date("2026-10-01T03:30:00Z");
    expect(resolveAnalyticsRange({ periodo: "7d" }, "America/Sao_Paulo", now)).toMatchObject({ dateFrom: "2026-09-24", dateTo: "2026-09-30", previousDateFrom: "2026-09-17", previousDateTo: "2026-09-23" });
    expect(resolveAnalyticsRange({ periodo: "7d" }, "America/Los_Angeles", now).dateTo).toBe("2026-09-29");
  });
  it("supports one year across a leap day", () => {
    expect(resolveAnalyticsRange({ periodo: "365d" }, "UTC", new Date("2024-03-01T12:00:00Z"))).toMatchObject({ dateFrom: "2023-03-02", dateTo: "2024-02-29" });
  });
  it("waits for the day to finish in every selected account timezone", () => {
    expect(resolveAnalyticsRange({ periodo: "7d" }, ["America/Sao_Paulo", "America/Los_Angeles"], new Date("2026-10-01T03:30:00Z"))).toMatchObject({ dateFrom: "2026-09-23", dateTo: "2026-09-29" });
  });
  it("compares a custom inclusive interval with equal previous days", () => {
    expect(resolveAnalyticsRange({ periodo: "custom", from: "2026-09-01", to: "2026-09-30" }, "UTC", new Date("2026-10-01"))).toMatchObject({ previousDateFrom: "2026-08-02", previousDateTo: "2026-08-31" });
  });
  it.each([["2026-02-30", "2026-03-01"], ["2026-09-30", "2026-09-01"], ["2025-01-01", "2026-09-30"], ["2026-09-01", "2027-01-01"]])("rejects invalid ranges %s — %s", (from, to) => {
    expect(() => resolveAnalyticsRange({ periodo: "custom", from, to }, "UTC", new Date("2026-10-01"))).toThrow();
  });
});
