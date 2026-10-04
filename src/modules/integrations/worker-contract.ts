import type { CollectionIdentity, CollectionStatus, NormalizedMetric } from "./data-contract";
import type { ProviderId } from "./provider-id";
import { computeRetry } from "./queue";

const ERROR_MESSAGES = {
  rate_limited: "Limite de requisições do provedor atingido.",
  timeout: "O provedor não respondeu dentro do prazo.",
  provider_unavailable: "O provedor está temporariamente indisponível.",
  auth: "A autorização do provedor precisa ser revisada.",
  invalid_request: "O provedor recusou os parâmetros da coleta.",
  unknown: "Não foi possível concluir a coleta no provedor.",
} as const;

export type ProviderCollectionResult = {
  metrics: NormalizedMetric[];
  complete: boolean;
  reconciliation: Record<string, unknown>;
  rawPayloads: Array<{ endpoint: string; payload: unknown; httpStatus?: number }>;
};

export type ProviderAdapter = {
  provider: ProviderId;
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
    errorMessage: ERROR_MESSAGES[retry.code],
  };
}
