import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createAsaasClient } from "./asaas-client";
import { resolveBillingCredentials, type BillingCredentials } from "./credentials";
import { asBillingDb } from "./db";
import type { BillingDeps } from "./event-processor";

/**
 * Dependências da camada financeira, ou null quando a integração não está configurada/liberada (tudo fica inerte, nunca cai em produção).
 * As credenciais vêm da fonte única (painel do Super Admin, com as variáveis de ambiente como reserva) e são lidas a cada chamada,
 * então uma troca de chave vale imediatamente em qualquer função ou rotina. Quem já leu as credenciais pode repassá-las.
 */
export async function createBillingRuntime(credentials?: BillingCredentials | null): Promise<BillingDeps | null> {
  const resolved = credentials === undefined ? await resolveBillingCredentials() : credentials;
  const service = createSupabaseServiceClient();
  if (!resolved?.config || !service) return null;
  return { db: asBillingDb(service), asaas: createAsaasClient(resolved.config), environment: resolved.config.environment };
}
