import "server-only";

// Etapa 2.2A: a integração só existe para o SANDBOX do Asaas. Não há caminho de código para a API de produção:
// a URL é uma constante e chaves de produção são recusadas. Liberar produção exige uma mudança de código autorizada.
export const ASAAS_SANDBOX_BASE_URL = "https://api-sandbox.asaas.com/v3";
export type BillingEnvironment = "sandbox";

export type AsaasConfig = { baseUrl: typeof ASAAS_SANDBOX_BASE_URL; apiKey: string; environment: BillingEnvironment };
export type AsaasConfigProblem = "missing_key" | "invalid_key" | "production_key" | "environment_not_sandbox";

type Env = Record<string, string | undefined>;

/** Diagnóstico sem expor a chave. */
export function asaasConfigProblem(env: Env = process.env): AsaasConfigProblem | null {
  if (env.ASAAS_ENVIRONMENT?.trim() !== "sandbox") return "environment_not_sandbox";
  const key = env.ASAAS_API_KEY?.trim();
  if (!key) return "missing_key";
  if (key.startsWith("$aact_prod_")) return "production_key";
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return "invalid_key";
  return null;
}

export function getAsaasConfig(env: Env = process.env): AsaasConfig | null {
  if (asaasConfigProblem(env)) return null;
  return { baseUrl: ASAAS_SANDBOX_BASE_URL, apiKey: env.ASAAS_API_KEY!.trim(), environment: "sandbox" };
}

/** Token do webhook (enviado pelo Asaas no cabeçalho asaas-access-token). Nunca é a chave de API. */
export function getAsaasWebhookToken(env: Env = process.env): string | null {
  const token = env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!token || !/^[A-Za-z0-9_-]{32,255}$/.test(token)) return null;
  if (token === env.ASAAS_API_KEY?.trim()) return null;
  return token;
}
