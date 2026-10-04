import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { runOneIntegrationJob } from "../integrations/worker-service";
import { loadMetaWorkerContext } from "./server";
import { createMetaProviderAdapter } from "./worker-adapter";

// Server-side entry point; authorization and attempt fencing remain in the worker.
export async function runOneMetaIntegrationJob(service: SupabaseClient<Database>): Promise<boolean> {
  return runOneIntegrationJob(service, { meta: createMetaProviderAdapter(identity => loadMetaWorkerContext(service, identity)) });
}
