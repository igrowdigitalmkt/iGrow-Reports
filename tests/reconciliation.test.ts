import { describe, expect, it } from "vitest";
import { reconcileTotals, shouldPromoteSnapshot } from "@/modules/integrations/reconciliation";

describe("snapshot reconciliation", () => {
  const base = { accountTotal: 100, entityTotals: [40, 60], tolerance: 0.01, expectedEntityCount: 2, receivedEntityCount: 2, currency: "BRL", timezone: "America/Sao_Paulo", requestedCurrency: "BRL", requestedTimezone: "America/Sao_Paulo" };
  it("confirms matching totals and scope", () => {
    const result = reconcileTotals(base);
    expect(result.confirmed).toBe(true);
    expect(result.difference).toBe(0);
    expect(shouldPromoteSnapshot(result, true)).toBe(true);
  });
  it("rejects incomplete entities and total mismatch", () => {
    const result = reconcileTotals({ ...base, entityTotals: [40], receivedEntityCount: 1 });
    expect(result.confirmed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["entities_incomplete", "total_mismatch"]));
    expect(shouldPromoteSnapshot(result, true)).toBe(false);
  });
  it("rejects currency, timezone and unavailable account totals", () => {
    const result = reconcileTotals({ ...base, accountTotal: null, currency: "USD", timezone: "UTC" });
    expect(result.confirmed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["account_total_unavailable", "currency_mismatch", "timezone_mismatch"]));
  });
  it("never promotes a partial collection", () => {
    const result = reconcileTotals(base);
    expect(shouldPromoteSnapshot(result, false)).toBe(false);
  });
});
