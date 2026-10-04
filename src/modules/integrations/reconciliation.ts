export type ReconciliationInput = {
  accountTotal: number | null;
  entityTotals: number[];
  tolerance: number;
  expectedEntityCount: number;
  receivedEntityCount: number;
  currency: string | null;
  timezone: string | null;
  requestedCurrency: string | null;
  requestedTimezone: string | null;
};

export type ReconciliationResult = {
  confirmed: boolean;
  reasons: string[];
  difference: number | null;
};

export function reconcileTotals(input: ReconciliationInput): ReconciliationResult {
  const reasons: string[] = [];
  if (input.accountTotal === null) reasons.push("account_total_unavailable");
  if (input.receivedEntityCount < input.expectedEntityCount) reasons.push("entities_incomplete");
  if (!input.currency || input.currency !== input.requestedCurrency) reasons.push("currency_mismatch");
  if (!input.timezone || input.timezone !== input.requestedTimezone) reasons.push("timezone_mismatch");
  const entitySum = input.entityTotals.reduce((sum, value) => sum + value, 0);
  const difference = input.accountTotal === null ? null : input.accountTotal - entitySum;
  if (difference !== null && Math.abs(difference) > input.tolerance) reasons.push("total_mismatch");
  return { confirmed: reasons.length === 0, reasons, difference };
}

export function shouldPromoteSnapshot(result: ReconciliationResult, collectionComplete: boolean): boolean {
  return collectionComplete && result.confirmed;
}
