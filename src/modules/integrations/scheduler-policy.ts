import type { CollectionIdentity } from "./data-contract";
import type { ProviderId } from "./provider-id";

export type QueuePriorityInput = CollectionIdentity & {
  isVisibleToUser?: boolean;
  isRecent?: boolean;
  hasConfirmedSnapshot?: boolean;
};

export function collectionPriority(input: QueuePriorityInput): number {
  if (input.isVisibleToUser) return 10;
  if (input.isRecent) return 20;
  if (!input.hasConfirmedSnapshot) return 30;
  return 100;
}

export type ProviderConcurrency = { maxInFlight: number; minIntervalMs: number };

const PROVIDER_POLICIES: Record<string, ProviderConcurrency> = {
  meta: { maxInFlight: 2, minIntervalMs: 250 },
  google: { maxInFlight: 4, minIntervalMs: 150 },
  tiktok: { maxInFlight: 2, minIntervalMs: 500 },
  linkedin: { maxInFlight: 2, minIntervalMs: 500 },
  youtube: { maxInFlight: 3, minIntervalMs: 250 },
};

export function providerConcurrency(provider: ProviderId | string): ProviderConcurrency {
  return PROVIDER_POLICIES[provider] ?? { maxInFlight: 1, minIntervalMs: 1_000 };
}

export function canStartProviderJob(provider: string, inFlight: number, lastStartedAt: Date | null, now = new Date()): boolean {
  const policy = providerConcurrency(provider);
  if (inFlight >= policy.maxInFlight) return false;
  if (lastStartedAt && now.getTime() - lastStartedAt.getTime() < policy.minIntervalMs) return false;
  return true;
}
