import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { runWorkerBatch } from "@/modules/integrations/worker-batch";
import { runOneMetaIntegrationJob } from "./job-worker";

// Pages that call this must export maxDuration >= INLINE_DRAIN_MAX_DURATION.
export const INLINE_DRAIN_MAX_DURATION = 300;
const INLINE_DRAIN_BUDGET_MS = 180_000;

// After an operator requests collection, drain the Meta queue in the same function
// invocation once the response is sent. Uses the scheduled worker's claim, lease,
// fencing and per-job authorization; the external schedule remains the fallback
// for jobs left by the budget or interrupted invocations (lease expiry).
export function scheduleMetaQueueDrain(service: SupabaseClient<Database>) {
  if (process.env.INLINE_COLLECTION_DISABLED === "true") return;
  after(async () => {
    try {
      await runWorkerBatch(() => runOneMetaIntegrationJob(service), { maxJobs: 20, budgetMs: INLINE_DRAIN_BUDGET_MS });
    } catch {
      // Do not copy provider URLs, credentials or database exception details.
      console.error("inline-collection-drain-failed", { provider: "meta" });
    }
  });
}
