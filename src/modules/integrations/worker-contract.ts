import type { CollectionIdentity, CollectionStatus, NormalizedMetric } from "./data-contract";
import { computeRetry } from "./queue";

export type ProviderCollectionResult = {
  metrics: NormalizedMetric[];
  complete: boolean;
  reconciliation: Record<string, unknown>;
  rawPayloads: Array<{ endpoint: string; payload: unknown; httpStatus?: number }>;
};

export type ProviderAdapter = {
  provider: string;
  collect(identity: CollectionIdentity): Promise<ProviderCollectionResult>;
};

export type JobTransition = {
  status: Extract<CollectionStatus, "partial" | "confirmed" | "failed">;
  nextAttemptAt: string | null;
  errorCode?: string;
  errorMessage?: string;
};

export function transitionAfterCollection(result: ProviderCollectionResult): JobTransition {
  const reconciled = result.reconciliation.confirmed !== false;
  return result.complete && reconciled
    ? { status: "confirmed", nextAttemptAt: null }
    : { status: "partial", nextAttemptAt: new Date(Date.now() + 60_000).toISOString() };
}

export function transitionAfterError(error: unknown, attemptCount: number, now = new Date()): JobTransition {
  const retry = computeRetry(error, attemptCount, now);
  return {
    status: retry.retryable ? "partial" : "failed",
    nextAttemptAt: retry.nextAttemptAt,
    errorCode: retry.code,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}
