export type QueueHealthInput = {
  queued: number;
  collecting: number;
  partial: number;
  failed: number;
  oldestQueuedAt: string | null;
  now?: Date;
};

export type QueueHealth = "healthy" | "degraded" | "blocked";

export function evaluateQueueHealth(input: QueueHealthInput): QueueHealth {
  const now = input.now ?? new Date();
  const oldestAge = input.oldestQueuedAt ? now.getTime() - Date.parse(input.oldestQueuedAt) : 0;
  if (input.failed >= 10 || oldestAge > 60 * 60 * 1000) return "blocked";
  if (input.failed > 0 || input.partial > input.queued + input.collecting) return "degraded";
  return "healthy";
}

export function queueHealthSummary(input: QueueHealthInput) {
  const status = evaluateQueueHealth(input);
  return { status, pending: input.queued + input.collecting + input.partial, failed: input.failed, oldestQueuedAt: input.oldestQueuedAt };
}
