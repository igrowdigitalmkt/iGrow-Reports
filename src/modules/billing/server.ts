import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createAsaasClient } from "./asaas-client";
import { getAsaasConfig } from "./config";
import { asBillingDb } from "./db";
import type { BillingDeps } from "./event-processor";

/** Dependências da camada financeira, ou null quando o Sandbox não está configurado (tudo fica inerte, nunca cai em produção). */
export function createBillingRuntime(): BillingDeps | null {
  const config = getAsaasConfig();
  const service = createSupabaseServiceClient();
  if (!config || !service) return null;
  return { db: asBillingDb(service), asaas: createAsaasClient(config), environment: config.environment };
}
