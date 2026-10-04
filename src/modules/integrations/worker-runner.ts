import type { CollectionIdentity } from "./data-contract";
import type { ProviderAdapter } from "./worker-contract";
import { transitionAfterCollection, transitionAfterError } from "./worker-contract";

export type WorkerPersistence = {
  markTransition: (transition: ReturnType<typeof transitionAfterCollection> | ReturnType<typeof transitionAfterError>) => Promise<void>;
  persistResult: (result: Awaited<ReturnType<ProviderAdapter["collect"]>>) => Promise<void>;
};

export async function runProviderJob(adapter: ProviderAdapter, identity: CollectionIdentity, persistence: WorkerPersistence): Promise<void> {
  try {
    const result = await adapter.collect(identity);
    await persistence.persistResult(result);
    await persistence.markTransition(transitionAfterCollection(result));
  } catch (error) {
    await persistence.markTransition(transitionAfterError(error, 0));
  }
}
