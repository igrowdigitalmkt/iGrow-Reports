import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { BillingEnvironment } from "./config";
import { interpretCredentials, type BillingCredentials } from "./credentials-core";
import { asBillingDb, callRpc, type BillingDb } from "./db";

export type { BillingCredentials } from "./credentials-core";
export { interpretCredentials } from "./credentials-core";

// Leitura das credenciais pelo servidor (service_role). Regras de interpretação e travas: ver credentials-core.ts.
export async function resolveBillingCredentials(options: { db?: BillingDb; env?: Record<string, string | undefined> } = {}): Promise<BillingCredentials | null> {
  const service = options.db ? null : createSupabaseServiceClient();
  const db = options.db ?? (service ? asBillingDb(service) : null);
  if (!db) return null;
  let raw: unknown;
  try { raw = await callRpc(db, "asaas_read_credentials"); } catch { return null; }
  return interpretCredentials(raw, options.env ?? process.env);
}

/** Ambiente em que a camada financeira opera agora (painel ou variáveis). Sem leitura possível, o padrão seguro é o Sandbox. */
export async function resolveBillingEnvironment(): Promise<BillingEnvironment> {
  return (await resolveBillingCredentials())?.environment ?? "sandbox";
}
