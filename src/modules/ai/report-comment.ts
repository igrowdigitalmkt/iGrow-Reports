import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ReportFacts } from "@/modules/reports/report-facts";
import { COMMENT_SYSTEM_PROMPT } from "./comment-prompt";
import { DEFAULT_MONTHLY_BUDGET_USD } from "./defaults";
import { verifyNumbers } from "./number-guard";
import { formatFactsForPrompt } from "./prompt-facts";

export const COMMENT_MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 1500;
export { DEFAULT_MONTHLY_BUDGET_USD };

// US$ por milhão de tokens (Claude Sonnet 5.5). Conferir a tabela de preços ao trocar de modelo.
const PRICE_PER_MTOK = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

export type UsageTokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function estimateCostUsd(tokens: UsageTokens): number {
  const cost = (tokens.input * PRICE_PER_MTOK.input + tokens.output * PRICE_PER_MTOK.output
    + tokens.cacheRead * PRICE_PER_MTOK.cacheRead + tokens.cacheWrite * PRICE_PER_MTOK.cacheWrite) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export type CommentInput = { agencyId: string; clientId: string; userId: string | null; facts: ReportFacts; profile?: Record<string, string> | null; sourceRef?: string };

export type CommentResult =
  | { ok: true; text: string; costUsd: number }
  | { ok: false; reason: "disabled" | "budget" | "unavailable" | "rejected_numbers" | "error"; message: string; draft?: string; unverified?: string[] };

type Messages = { create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> };
export type CommentDeps = {
  anthropic?: { messages: Messages };
  supabase?: NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
};

type UsageStatus = "ok" | "blocked_disabled" | "blocked_budget" | "rejected_numbers" | "error";

export async function generateReportComment(input: CommentInput, deps: CommentDeps = {}): Promise<CommentResult> {
  const supabase = deps.supabase ?? createSupabaseServiceClient();
  if (!supabase) return { ok: false, reason: "unavailable", message: "A IA não está disponível neste ambiente." };

  const promptFacts = formatFactsForPrompt(input.facts, input.profile);
  const factsText = JSON.stringify(promptFacts, null, 2);
  const factsHash = createHash("sha256").update(factsText).digest("hex").slice(0, 32);

  const log = async (status: UsageStatus, extra: { tokens?: UsageTokens; costUsd?: number; verified?: boolean; requestId?: string | null } = {}) => {
    const tokens = extra.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const { error } = await supabase.from("ai_usage").insert({
      agency_id: input.agencyId, client_id: input.clientId, user_id: input.userId, feature: "report_comment",
      model: COMMENT_MODEL, status, input_tokens: tokens.input, output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead, cache_write_tokens: tokens.cacheWrite, cost_usd: extra.costUsd ?? 0,
      verifier_passed: extra.verified ?? null, facts_hash: factsHash, source_ref: input.sourceRef?.slice(0, 120) ?? null,
      request_id: extra.requestId?.slice(0, 120) ?? null,
    });
    // Falha ao registrar não derruba a resposta, mas fica visível nos logs do servidor.
    if (error) console.error("ai_usage insert failed", error.code);
  };

  // Configuração: ausência de linha significa os padrões (ligada, orçamento mensal padrão).
  const [agencySettings, clientSettings, monthCost] = await Promise.all([
    supabase.from("ai_settings").select("enabled,monthly_budget_usd").eq("agency_id", input.agencyId).maybeSingle(),
    supabase.from("ai_client_settings").select("enabled").eq("client_id", input.clientId).maybeSingle(),
    supabase.rpc("ai_month_cost", { p_agency_id: input.agencyId }),
  ]);
  if (agencySettings.error || clientSettings.error || monthCost.error || monthCost.data == null) {
    return { ok: false, reason: "unavailable", message: "Não foi possível verificar a configuração e a cota da IA." };
  }
  const enabled = (agencySettings.data?.enabled ?? true) && (clientSettings.data?.enabled ?? true);
  if (!enabled) {
    await log("blocked_disabled");
    return { ok: false, reason: "disabled", message: "A IA está desligada para esta organização ou cliente." };
  }
  const budget = Number(agencySettings.data?.monthly_budget_usd ?? DEFAULT_MONTHLY_BUDGET_USD);
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
      model: COMMENT_MODEL, max_tokens: MAX_TOKENS, system: COMMENT_SYSTEM_PROMPT,
      output_config: { effort: "medium" },
      messages: [{ role: "user", content: `Fatos confirmados do período (JSON):\n${factsText}` }],
    });
  } catch (error) {
    await log("error");
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    return { ok: false, reason: "error", message: status === 429 ? "A IA está sobrecarregada. Tente novamente em instantes." : "Não foi possível gerar o comentário agora." };
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
    return { ok: false, reason: "error", message: "A IA não concluiu o comentário. Tente novamente." };
  }
  const check = verifyNumbers(text, [factsText]);
  if (!check.ok) {
    await log("rejected_numbers", { tokens, costUsd, verified: false, requestId });
    return { ok: false, reason: "rejected_numbers", message: "O texto gerado citou números que não estão nos dados e foi bloqueado.", draft: text, unverified: check.unverified };
  }
  await log("ok", { tokens, costUsd, verified: true, requestId });
  return { ok: true, text, costUsd };
}
