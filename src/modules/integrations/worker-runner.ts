import type { CollectionIdentity } from "./data-contract";
import type { JobTransition, ProviderAdapter, ProviderCollectionResult } from "./worker-contract";
import { transitionAfterCollection, transitionAfterError } from "./worker-contract";

export type WorkerPersistence = {
  markTransition: (transition: ReturnType<typeof transitionAfterCollection> | ReturnType<typeof transitionAfterError>) => Promise<void>;
  persistResult: (result: Awaited<ReturnType<ProviderAdapter["collect"]>>) => Promise<void>;
  recordHealth?: (event: { ok: boolean; errorCode?: string; latencyMs?: number }) => Promise<void>;
};

export async function runProviderJob(adapter: ProviderAdapter, identity: CollectionIdentity, persistence: WorkerPersistence, attemptCount = 0): Promise<void> {
  const startedAt = Date.now();
  let result: ProviderCollectionResult;
  try {
    result = await adapter.collect(identity);
  } catch (error) {
    const transition = transitionAfterError(error, attemptCount);
    await persistence.markTransition(transition);
    await persistence.recordHealth?.({ ok: false, errorCode: transition.errorCode, latencyMs: Date.now() - startedAt });
    return;
  }

  let transition: JobTransition;
  try {
    await persistence.persistResult(result);
    transition = transitionAfterCollection(result);
  } catch {
    transition = {
      status: "partial",
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
      errorCode: "persistence_error",
      errorMessage: "Não foi possível persistir a coleta. Uma nova tentativa foi agendada.",
    };
  }
  // Finalization and monitoring errors must never trigger a second transition.
  await persistence.markTransition(transition);
  await persistence.recordHealth?.({ ok: true, latencyMs: Date.now() - startedAt });
}
