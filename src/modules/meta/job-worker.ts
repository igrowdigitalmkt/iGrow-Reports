import "server-only";
import { getAgencyBillingAccess } from "@/modules/billing/access";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { runOneIntegrationJob } from "../integrations/worker-service";
import { loadMetaWorkerContext } from "./server";
import { createMetaProviderAdapter } from "./worker-adapter";

// Server-side entry point; authorization and attempt fencing remain in the worker.
export async function runOneMetaIntegrationJob(service: SupabaseClient<Database>): Promise<boolean> {
  return runOneIntegrationJob(service, { meta: createMetaProviderAdapter(identity => loadMetaWorkerContext(service, identity)) },"meta", {
    // Coleta é operação paga: organização suspensa/encerrada (ou sem como confirmar o plano) não chama a Meta.
    isBlocked: async identity => {
      const { data: owner } = await service.from("clients").select("agency_id").eq("id", identity.clientId).maybeSingle();
      return !owner || await getAgencyBillingAccess(service, owner.agency_id) !== "allowed";
    },
  });
}
