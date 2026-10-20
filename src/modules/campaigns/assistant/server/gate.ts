import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_MONTHLY_BUDGET_USD } from "@/modules/ai/defaults";
import { estimateCostUsd, parseAiEntitlement } from "@/modules/ai/guarded-text";
import { ceilUsd } from "@/modules/ai/reservation";

/**
 * Identificação própria do consumo do chat de Campanhas em `ai_usage.feature`. NÃO use 'report_comment', 'portfolio_summary',
 * 'whatsapp_summary' nem 'agent_decision' para contornar a falta dela.
 */
export const CAMPAIGN_CHAT_FEATURE = "campaign_chat";

/** Limites objetivos de uma chamada do chat. */
export const CHAT_CALL_LIMITS = { maxOutputTokens: 900, maxInputChars: 60_000 };

/**
 * Valor RESERVADO antes de uma chamada: limite superior prático do custo, a partir dos bytes UTF-8 de tudo que será enviado (um token tem ao
 * menos um byte), com margem para o enquadramento da mensagem, cobrado à taxa mais cara de entrada e com a saída no máximo configurado
 * (max_tokens). NÃO é uma garantia contratual: a contagem de tokens é do provedor. A liquidação troca este valor pelo custo real.
 */
export const RESERVATION_FRAMING_TOKENS = 500;
export function reservationCostUsd(inputBytes: number): number {
  return ceilUsd(estimateCostUsd({ input: 0, output: CHAT_CALL_LIMITS.maxOutputTokens, cacheRead: 0, cacheWrite: Math.max(0, Math.ceil(inputBytes)) + RESERVATION_FRAMING_TOKENS }));
}

/** Chave de operação por ambiente: sem CAMPAIGN_CHAT_ENABLED=1 nenhuma chamada paga acontece, qualquer que seja o resto. */
export const campaignChatEnabledByOperator = () => process.env.CAMPAIGN_CHAT_ENABLED === "1";

/**
 * Folga prévia da cota (filtro rápido, antes da leitura dos dados): usa o MESMO modelo e a MESMA tabela de preços da reserva, só que com
 * caracteres no lugar de bytes (bytes >= caracteres), portanto nunca excede o valor realmente reservado. A decisão financeira é a reserva.
 */
export function estimateCallCostUsd(inputChars: number): number {
  return reservationCostUsd(inputChars);
}

export type GateConfig = {
  /** Chave de operação do ambiente (CAMPAIGN_CHAT_ENABLED=1). */
  enabledByOperator: boolean;
  /** O banco do ambiente ACEITA 'campaign_chat' em ai_usage.feature (confirmado em tempo de execução, nunca presumido). */
  featureRegistered: boolean;
  /** O banco tem a estrutura de reservas atômicas completa (estados, colunas e funções), confirmada em tempo de execução. */
  reservationsReady: boolean;
  /** A contabilização está funcionando (não houve falha recente ao gravar o consumo). */
  accountingHealthy: boolean;
  modelConfigured: boolean;
  /** Resposta de agency_ai_entitlement já interpretada; null = formato inesperado. */
  commercial: { allowed: boolean; budgetUsd: number | null; restricted: boolean } | null;
  agencyEnabled: boolean | null; clientEnabled: boolean | null;
  agencyBudgetUsd: number | null; monthCostUsd: number | null;
  /** Folga: custo máximo estimado de uma chamada. */
  estimatedCallCostUsd: number;
};
export type GateReason = "not_enabled" | "feature_not_registered" | "reservation_unavailable" | "accounting" | "model_unavailable" | "plan" | "restricted" | "disabled" | "budget" | "unverifiable";
export type GateDecision = { allowed: true } | { allowed: false; reason: GateReason; message: string };

/**
 * Mesmas regras de runGuardedGeneration (plano, interruptores da organização e do cliente, cota mensal), mais a chave de operação,
 * a categoria própria do chat confirmada no banco, a saúde da contabilização e a folga de uma chamada.
 * LIMITE: a cota é conferida ANTES da chamada com o gasto já registrado; chamadas simultâneas podem ultrapassá-la em, no máximo, o custo
 * de cada chamada em andamento. Isto NÃO é um teto rígido (ver docs/ARQUITETURA_AGENTE_EXECUTOR_META.md e a recomendação de reserva atômica).
 */
export function evaluateChatGate(config: GateConfig): GateDecision {
  if (!config.enabledByOperator) return { allowed: false, reason: "not_enabled", message: "O assistente ainda não foi liberado neste ambiente." };
  if (!config.featureRegistered) return { allowed: false, reason: "feature_not_registered", message: "O consumo do chat de Campanhas não pode ser contabilizado neste ambiente; o assistente permanece indisponível." };
  if (!config.reservationsReady) return { allowed: false, reason: "reservation_unavailable", message: "A reserva de orçamento de IA não está disponível neste ambiente; o assistente permanece indisponível." };
  if (!config.accountingHealthy) return { allowed: false, reason: "accounting", message: "O registro de consumo de IA está com falha; o assistente foi suspenso até a contabilização voltar." };
  if (!config.modelConfigured) return { allowed: false, reason: "model_unavailable", message: "A IA não está configurada neste ambiente." };
  if (!config.commercial || config.monthCostUsd == null || config.agencyEnabled == null || config.clientEnabled == null) {
    return { allowed: false, reason: "unverifiable", message: "Não foi possível verificar a configuração e a cota da IA." };
  }
  if (!config.commercial.allowed) return { allowed: false, reason: config.commercial.restricted ? "restricted" : "plan", message: config.commercial.restricted
    ? "A IA está indisponível porque o acesso desta organização está restrito. Regularize em Assinatura." : "A IA não está disponível no plano desta organização." };
  if (!config.agencyEnabled || !config.clientEnabled) return { allowed: false, reason: "disabled", message: "A IA está desligada para esta organização ou cliente." };
  const budget = Math.min(config.agencyBudgetUsd ?? config.commercial.budgetUsd ?? DEFAULT_MONTHLY_BUDGET_USD, config.commercial.budgetUsd ?? Infinity);
  if (config.monthCostUsd + config.estimatedCallCostUsd > budget) return { allowed: false, reason: "budget", message: "O orçamento mensal de IA desta organização foi atingido." };
  return { allowed: true };
}

export type GateRuntime = Pick<GateConfig, "enabledByOperator" | "featureRegistered" | "reservationsReady" | "accountingHealthy" | "modelConfigured" | "estimatedCallCostUsd">;

/** Valores que não exigem consultar o banco: usados quando a chave de operação, a categoria ou a contabilização já bloqueiam. */
export const unreadGateConfig = (runtime: GateRuntime): GateConfig => ({ ...runtime, commercial: null, agencyEnabled: null, clientEnabled: null, agencyBudgetUsd: null, monthCostUsd: null });

/**
 * Lê a configuração de IA da organização verificada (nunca de uma organização vinda do navegador). Usa o cliente de serviço apenas
 * para estas leituras de configuração e cota, depois de a organização e o cliente já terem sido autorizados pela sessão do usuário.
 */
export async function readGateConfig(supabase: Pick<SupabaseClient, "from" | "rpc">, agencyId: string, clientId: string, runtime: GateRuntime): Promise<GateConfig> {
  const [agency, client, month, entitlement] = await Promise.all([
    supabase.from("ai_settings").select("enabled,monthly_budget_usd").eq("agency_id", agencyId).maybeSingle(),
    supabase.from("ai_client_settings").select("enabled").eq("client_id", clientId).maybeSingle(),
    supabase.rpc("ai_month_cost", { p_agency_id: agencyId }),
    supabase.rpc("agency_ai_entitlement", { p_agency_id: agencyId }),
  ]);
  // Banco sem o catálogo comercial: sem plano não há restrição (igual a runGuardedGeneration). Qualquer outra falha nega.
  const noCatalog = entitlement.error?.code === "PGRST202" || entitlement.error?.code === "42883";
  const commercial = noCatalog ? { allowed: true, budgetUsd: null, restricted: false } : entitlement.error ? null : parseAiEntitlement(entitlement.data);
  return {
    ...runtime, commercial,
    agencyEnabled: agency.error ? null : (agency.data?.enabled ?? true), clientEnabled: client.error ? null : (client.data?.enabled ?? true),
    agencyBudgetUsd: agency.error || agency.data?.monthly_budget_usd == null ? null : Number(agency.data.monthly_budget_usd),
    monthCostUsd: month.error || month.data == null ? null : Number(month.data),
  };
}
