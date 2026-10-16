import "server-only";
import { z } from "zod";
import { asaasConfigProblem, asaasKeyProblem, buildAsaasConfig, configuredBillingEnvironment, getAsaasConfig, getAsaasWebhookToken, productionUnlocked, type AsaasConfig, type AsaasConfigProblem, type BillingEnvironment } from "./config";

// Fonte única das credenciais do Asaas usadas pela camada financeira (cliente, checkout, webhook, reconciliação, cancelamento e rotina periódica).
//  1) Registradas no Super Admin (Integrações > Pagamentos): chave e tokens ficam no Supabase Vault e só são lidos aqui, com o service_role.
//     Trocar a chave ou o token vale na próxima requisição de qualquer função/rotina, sem novo deploy.
//  2) Reserva: variáveis de ambiente (ASAAS_ENVIRONMENT, ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN), apenas enquanto NADA foi registrado no painel.
// As travas de produção valem nas duas origens: ASAAS_PRODUCTION_UNLOCK=yes (variável de infraestrutura) e billing_settings.live_enabled (banco).
// Qualquer falha de leitura fecha tudo (null): nunca se cai em outro ambiente ou outra credencial por engano.
const schema = z.object({
  managed: z.boolean(), environment: z.enum(["sandbox", "production"]).nullish(),
  api_key: z.string().nullish(), webhook_token: z.string().nullish(), webhook_token_previous: z.string().nullish(),
});

const WEBHOOK_TOKEN = /^[A-Za-z0-9_-]{32,255}$/;

export type BillingCredentials = {
  source: "panel" | "env";
  environment: BillingEnvironment;
  /** Configuração operacional (com a trava de produção). Nula = integração inerte. */
  config: AsaasConfig | null;
  problem: AsaasConfigProblem | null;
  /** Para o teste de conexão do Super Admin: ignora só a trava de desbloqueio (o teste não faz operação financeira). */
  probeConfig: AsaasConfig | null;
  /** Tokens aceitos no webhook: o atual e, em transição, o anterior. */
  webhookTokens: string[];
};

export function interpretCredentials(raw: unknown, env: Record<string, string | undefined>): BillingCredentials | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  if (!c.managed) {
    const token = getAsaasWebhookToken(env);
    const problem = asaasConfigProblem(env);
    const environment = configuredBillingEnvironment(env);
    const probeProblem = asaasKeyProblem(env.ASAAS_ENVIRONMENT?.trim(), env.ASAAS_API_KEY, true);
    return {
      source: "env", environment, config: getAsaasConfig(env), problem,
      probeConfig: probeProblem ? null : buildAsaasConfig(environment, env.ASAAS_API_KEY!), webhookTokens: token ? [token] : [],
    };
  }
  const environment: BillingEnvironment = c.environment ?? "sandbox";
  const problem = asaasKeyProblem(c.environment, c.api_key, productionUnlocked(env));
  const probeProblem = asaasKeyProblem(c.environment, c.api_key, true);
  const key = c.api_key?.trim() ?? "";
  // O token do painel é o definitivo; enquanto não houver um, o das variáveis de ambiente continua valendo (nunca igual à chave).
  const fromPanel = [c.webhook_token, c.webhook_token_previous];
  const fallback = fromPanel[0] ? null : getAsaasWebhookToken(env);
  const webhookTokens = [...fromPanel, fallback].filter((token): token is string => Boolean(token) && WEBHOOK_TOKEN.test(token!) && token !== key);
  return {
    source: "panel", environment, config: problem ? null : buildAsaasConfig(environment, key), problem,
    probeConfig: probeProblem ? null : buildAsaasConfig(environment, key), webhookTokens,
  };
}

