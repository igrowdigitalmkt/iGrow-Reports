import type { CollectionIdentity } from "./data-contract";
import type { ProviderAdapter } from "./worker-contract";
import { transitionAfterCollection, transitionAfterError } from "./worker-contract";

export type WorkerPersistence = {
  markTransition: (transition: ReturnType<typeof transitionAfterCollection> | ReturnType<typeof transitionAfterError>) => Promise<void>;
  persistResult: (result: Awaited<ReturnType<ProviderAdapter["collect"]>>) => Promise<void>;
  recordHealth?: (event: { ok: boolean; errorCode?: string; latencyMs?: number }) => Promise<void>;
};

export async function runProviderJob(adapter: ProviderAdapter, identity: CollectionIdentity, persistence: WorkerPersistence, attemptCount = 0): Promise<void> {
  const startedAt = Date.now();
  try {
    const result = await adapter.collect(identity);
    await persistence.persistResult(result);
    await persistence.recordHealth?.({ ok: true, latencyMs: Date.now() - startedAt });
    await persistence.markTransition(transitionAfterCollection(result));
  } catch (error) {
    await persistence.recordHealth?.({ ok: false, errorCode: String(error) , latencyMs: Date.now() - startedAt });
    await persistence.markTransition(transitionAfterError(error, attemptCount));
  }
}
