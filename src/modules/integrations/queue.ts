import type { CollectionStatus } from "./data-contract";

export type CollectionJob = {
  id: string;
  idempotencyKey: string;
  status: CollectionStatus;
  priority: number;
  attemptCount: number;
  nextAttemptAt: string;
};

export type RetryDecision = {
  retryable: boolean;
  code: "rate_limited" | "timeout" | "provider_unavailable" | "auth" | "invalid_request" | "unknown";
  nextAttemptAt: string | null;
};

const RETRYABLE_CODES = new Set(["rate_limited", "timeout", "provider_unavailable"]);

export function classifyCollectionError(error: unknown): RetryDecision["code"] {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("429") || message.includes("rate limit") || message.includes("too many")) return "rate_limited";
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (message.includes("502") || message.includes("503") || message.includes("504") || message.includes("unavailable")) return "provider_unavailable";
  if (message.includes("401") || message.includes("403") || message.includes("token") || message.includes("permission")) return "auth";
  if (message.includes("400") || message.includes("invalid") || message.includes("parameter")) return "invalid_request";
  return "unknown";
}

export function computeRetry(error: unknown, attemptCount: number, now = new Date()): RetryDecision {
  const code = classifyCollectionError(error);
  if (!RETRYABLE_CODES.has(code)) return { retryable: false, code, nextAttemptAt: null };
  const baseDelayMs = code === "rate_limited" ? 60_000 : 15_000;
  const delayMs = Math.min(baseDelayMs * 2 ** Math.max(0, attemptCount), 6 * 60 * 60 * 1000);
  return { retryable: true, code, nextAttemptAt: new Date(now.getTime() + delayMs).toISOString() };
}

export function compareJobs(a: CollectionJob, b: CollectionJob): number {
  const priority = a.priority - b.priority;
  if (priority !== 0) return priority;
  return new Date(a.nextAttemptAt).getTime() - new Date(b.nextAttemptAt).getTime();
}

export function isClaimable(job: CollectionJob, now = new Date()): boolean {
  return (job.status === "queued" || job.status === "partial") && new Date(job.nextAttemptAt).getTime() <= now.getTime();
}
