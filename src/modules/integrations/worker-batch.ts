export type WorkerBatchResult = { processed: number; stopReason: "empty" | "job_limit" | "time_budget" };

// The time budget prevents new claims; it does not interrupt an active job.
export async function runWorkerBatch(runOne: () => Promise<boolean>,options: {
  maxJobs: number; budgetMs: number; now?: () => number;
}): Promise<WorkerBatchResult> {
  if (!Number.isInteger(options.maxJobs) || options.maxJobs < 1 || options.maxJobs > 20
    || !Number.isFinite(options.budgetMs) || options.budgetMs < 1 || options.budgetMs > 240_000) throw new Error("Limites do executor inválidos.");
  const now = options.now ?? (() => performance.now());
  const started = now();
  let processed = 0;
  while (processed < options.maxJobs) {
    if (now() - started >= options.budgetMs) return { processed,stopReason: "time_budget" };
    if (!await runOne()) return { processed,stopReason: "empty" };
    processed += 1;
  }
  return { processed,stopReason: "job_limit" };
}
