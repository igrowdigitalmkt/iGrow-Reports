import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { DEFAULT_MONTHLY_BUDGET_USD } from "./defaults";
import { verifyNumbers } from "./number-guard";

export const AI_MODEL = "claude-sonnet-5-5";
const DEFAULT_MAX_TOKENS = 1500;
export { DEFAULT_MONTHLY_BUDGET_USD };

// US$ por milhão de tokens (Claude Sonnet 5.5). Conferir a tabela de preços ao trocar de modelo.
const PRICE_PER_MTOK = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

export type UsageTokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function estimateCostUsd(tokens: UsageTokens): number {
  const cost = (tokens.input * PRICE_PER_MTOK.input + tokens.output * PRICE_PER_MTOK.output
    + tokens.cacheRead * PRICE_PER_MTOK.cacheRead + tokens.cacheWrite * PRICE_PER_MTOK.cacheWrite) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export type AiFeature = "report_comment" | "portfolio_summary" | "whatsapp_summary";

export type GuardedInput = {
  agencyId: string;
  // Texto de um cliente respeita o liga/desliga do cliente; texto da carteira inteira passa null.
  clientId: string | null;
  userId: string | null;
  feature: AiFeature;
  system: string;
  // Fatos já formatados (JSON em texto). Todo número citado no texto precisa existir aqui.
  factsText: string;
  factsLabel: string;
  sourceRef?: string;
  maxTokens?: number;
};

export type GuardedResult =
  | { ok: true; text: string; costUsd: number }
  | { ok: false; reason: "disabled" | "budget" | "unavailable" | "rejected_numbers" | "error"; message: string; draft?: string; unverified?: string[] };

type Messages = { create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };
export type GuardedDeps = {
  anthropic?: { messages: Messages };
  supabase?: NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
};

/** Resposta de agency_ai_entitlement; formato inesperado vale como indisponível (nega por segurança). */
export function parseAiEntitlement(value: unknown): { allowed: boolean; budgetUsd: number | null } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { allowed, budget_usd: budget } = value as { allowed?: unknown; budget_usd?: unknown };
  if (typeof allowed !== "boolean") return null;
  if (budget !== null && budget !== undefined && (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0)) return null;
  return { allowed, budgetUsd: typeof budget === "number" ? budget : null };
}

type UsageStatus = "ok" | "blocked_disabled" | "blocked_budget" | "rejected_numbers" | "error";

// Caminho único de toda chamada de IA: configuração, cota, chamada, verificação de números e registro de custo.
export async function runGuardedGeneration(input: GuardedInput, deps: GuardedDeps = {}): Promise<GuardedResult> {
  const supabase = deps.supabase ?? createSupabaseServiceClient();
  if (!supabase) return { ok: false, reason: "unavailable", message: "A IA não está disponível neste ambiente." };

  const factsHash = createHash("sha256").update(input.factsText).digest("hex").slice(0, 32);

  const log = async (status: UsageStatus, extra: { tokens?: UsageTokens; costUsd?: number; verified?: boolean; requestId?: string | null } = {}) => {
    const tokens = extra.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const { error } = await supabase.from("ai_usage").insert({
      agency_id: input.agencyId, client_id: input.clientId, user_id: input.userId, feature: input.feature,
      model: AI_MODEL, status, input_tokens: tokens.input, output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead, cache_write_tokens: tokens.cacheWrite, cost_usd: extra.costUsd ?? 0,
      verifier_passed: extra.verified ?? null, facts_hash: factsHash, source_ref: input.sourceRef?.slice(0, 120) ?? null,
      request_id: extra.requestId?.slice(0, 120) ?? null,
    });
    // Falha ao registrar não derruba a resposta, mas fica visível nos logs do servidor.
    if (error) console.error("ai_usage insert failed", error.code);
  };

  // Configuração: ausência de linha significa os padrões (ligada, orçamento mensal padrão).
  const [agencySettings, clientSettings, monthCost, entitlement] = await Promise.all([
    supabase.from("ai_settings").select("enabled,monthly_budget_usd").eq("agency_id", input.agencyId).maybeSingle(),
    input.clientId
      ? supabase.from("ai_client_settings").select("enabled").eq("client_id", input.clientId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase.rpc("ai_month_cost", { p_agency_id: input.agencyId }),
    supabase.rpc("agency_ai_entitlement", { p_agency_id: input.agencyId }),
  ]);
  // Banco ainda sem o catálogo comercial (função inexistente): não há plano nenhum, então a IA segue como antes.
  // Qualquer outra falha, ou resposta inesperada, nega por segurança.
  const commercialMissing = entitlement.error?.code === "PGRST202" || entitlement.error?.code === "42883";
  const commercial = commercialMissing ? { allowed: true, budgetUsd: null } : parseAiEntitlement(entitlement.data);
  if (agencySettings.error || clientSettings.error || monthCost.error || monthCost.data == null || (entitlement.error && !commercialMissing) || !commercial) {
    return { ok: false, reason: "unavailable", message: "Não foi possível verificar a configuração e a cota da IA." };
  }
  // Direitos comerciais (plano da organização, concessões e interruptor global); sem plano atribuído não há restrição.
  if (!commercial.allowed) {
    await log("blocked_disabled");
    return { ok: false, reason: "disabled", message: "A IA não está disponível no plano desta organização." };
  }
  const enabled = (agencySettings.data?.enabled ?? true) && (clientSettings.data?.enabled ?? true);
  if (!enabled) {
    await log("blocked_disabled");
    return { ok: false, reason: "disabled", message: "A IA está desligada para esta organização ou cliente." };
  }
  // O teto do plano nunca é ultrapassado, mesmo que a configuração da organização seja maior.
  const budget = Math.min(Number(agencySettings.data?.monthly_budget_usd ?? DEFAULT_MONTHLY_BUDGET_USD), commercial.budgetUsd ?? Infinity);
  if (Number(monthCost.data) >= budget) {
    await log("blocked_budget");
    return { ok: false, reason: "budget", message: "O orçamento mensal de IA desta organização foi atingido." };
  }

  let anthropic = deps.anthropic;
  if (!anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) return { ok: false, reason: "unavailable", message: "A IA não está configurada neste ambiente." };
    anthropic = new Anthropic();
  }

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: AI_MODEL, max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS, system: input.system,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: `${input.factsLabel}\n${input.factsText}` }],
    });
  } catch (error) {
    await log("error");
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    return { ok: false, reason: "error", message: status === 429 ? "A IA está sobrecarregada. Tente novamente em instantes." : "Não foi possível gerar o texto agora." };
  }

  const tokens: UsageTokens = {
    input: response.usage.input_tokens ?? 0, output: response.usage.output_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? 0, cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  };
  const costUsd = estimateCostUsd(tokens);
  const requestId = (response as { _request_id?: string | null })._request_id ?? null;
  const text = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").trim();

  if (response.stop_reason !== "end_turn" || !text) {
    await log("error", { tokens, costUsd, requestId });
    return { ok: false, reason: "error", message: "A IA não concluiu o texto. Tente novamente." };
  }
  const check = verifyNumbers(text, [input.factsText]);
  if (!check.ok) {
    await log("rejected_numbers", { tokens, costUsd, verified: false, requestId });
    return { ok: false, reason: "rejected_numbers", message: "O texto gerado citou números que não estão nos dados e foi bloqueado.", draft: text, unverified: check.unverified };
  }
  await log("ok", { tokens, costUsd, verified: true, requestId });
  return { ok: true, text, costUsd };
}
