import "server-only";

// Integração com o Asaas. SANDBOX é o padrão. PRODUÇÃO só funciona com as quatro travas juntas (nenhuma é automática):
//  1) ASAAS_ENVIRONMENT=production; 2) ASAAS_PRODUCTION_UNLOCK=yes (desbloqueio deliberado); 3) chave de produção ($aact_prod_...);
//  4) billing_settings.live_enabled = true no banco (sem isto o banco recusa criar contratação em produção).
// Chave de produção com ambiente sandbox (e chave de sandbox com ambiente production) é sempre recusada.
export const ASAAS_SANDBOX_BASE_URL = "https://api-sandbox.asaas.com/v3";
export const ASAAS_PRODUCTION_BASE_URL = "https://api.asaas.com/v3";
export type BillingEnvironment = "sandbox" | "production";

export type AsaasConfig = { baseUrl: typeof ASAAS_SANDBOX_BASE_URL | typeof ASAAS_PRODUCTION_BASE_URL; apiKey: string; environment: BillingEnvironment };
export type AsaasConfigProblem = "missing_key" | "invalid_key" | "production_key" | "sandbox_key" | "environment_invalid" | "production_not_unlocked";

type Env = Record<string, string | undefined>;

/** Ambiente em que os eventos do webhook são gravados (nunca "production" por engano: precisa estar escrito). */
export function configuredBillingEnvironment(env: Env = process.env): BillingEnvironment {
  return env.ASAAS_ENVIRONMENT?.trim() === "production" ? "production" : "sandbox";
}

/** Desbloqueio deliberado da produção: continua sendo uma variável de infraestrutura (não é gerenciada pelo painel). */
export function productionUnlocked(env: Env = process.env): boolean {
  return env.ASAAS_PRODUCTION_UNLOCK?.trim() === "yes";
}

/** Confere ambiente + chave (venham das variáveis ou do painel) e as travas de produção. Diagnóstico sem expor a chave. */
export function asaasKeyProblem(environment: string | null | undefined, rawKey: string | null | undefined, unlocked: boolean): AsaasConfigProblem | null {
  if (environment !== "sandbox" && environment !== "production") return "environment_invalid";
  const key = rawKey?.trim();
  if (!key) return "missing_key";
  const isProductionKey = key.startsWith("$aact_prod_");
  if (environment === "sandbox" && isProductionKey) return "production_key";
  if (environment === "production" && !isProductionKey) return "sandbox_key";
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return "invalid_key";
  if (environment === "production" && !unlocked) return "production_not_unlocked";
  return null;
}

export function buildAsaasConfig(environment: BillingEnvironment, apiKey: string): AsaasConfig {
  return { baseUrl: environment === "production" ? ASAAS_PRODUCTION_BASE_URL : ASAAS_SANDBOX_BASE_URL, apiKey: apiKey.trim(), environment };
}

/** Diagnóstico das variáveis de ambiente (origem de reserva quando nada foi registrado no painel). */
export function asaasConfigProblem(env: Env = process.env): AsaasConfigProblem | null {
  return asaasKeyProblem(env.ASAAS_ENVIRONMENT?.trim(), env.ASAAS_API_KEY, productionUnlocked(env));
}

export function getAsaasConfig(env: Env = process.env): AsaasConfig | null {
  if (asaasConfigProblem(env)) return null;
  return buildAsaasConfig(configuredBillingEnvironment(env), env.ASAAS_API_KEY!);
}

/** Token do webhook (enviado pelo Asaas no cabeçalho asaas-access-token). Nunca é a chave de API. */
export function getAsaasWebhookToken(env: Env = process.env): string | null {
  const token = env.ASAAS_WEBHOOK_TOKEN?.trim();
  if (!token || !/^[A-Za-z0-9_-]{32,255}$/.test(token)) return null;
  if (token === env.ASAAS_API_KEY?.trim()) return null;
  return token;
}
