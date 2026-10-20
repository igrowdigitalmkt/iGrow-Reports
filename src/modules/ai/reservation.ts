import type { SupabaseClient } from "@supabase/supabase-js";

// Reserva financeira ATÔMICA do consumo de IA, reutilizável por qualquer funcionalidade (chat de Campanhas hoje; relatórios, carteira,
// WhatsApp e motor de decisão quando migrarem). O PostgreSQL é a autoridade: reserve_ai_usage valida, serializa por organização,
// aplica a idempotência, confere o orçamento ATUAL e cria a reserva na MESMA transação (supabase/migrations/202610200002_*.sql).
// Estas funções só falam com o banco; nada aqui decide orçamento. Sempre falham de forma segura: erro, função ausente ou resposta
// inesperada nunca autorizam uma chamada paga.

export type ReserveOutcome = "reserved" | "duplicate_in_flight" | "duplicate_completed" | "duplicate_unknown" | "conflict" | "budget" | "disabled" | "plan" | "restricted" | "invalid";
const OUTCOMES: ReadonlySet<string> = new Set(["reserved", "duplicate_in_flight", "duplicate_completed", "duplicate_unknown", "conflict", "budget", "disabled", "plan", "restricted", "invalid"]);

export type ReserveInput = {
  agencyId: string; clientId: string | null; userId: string | null; feature: string; model: string;
  /** Identificador único da solicitação (idempotência distribuída por organização e funcionalidade). */
  requestKey: string;
  /** Hash do escopo autorizado: o mesmo identificador não pode ser reutilizado com outro cliente, usuário ou contexto. */
  scopeHash: string;
  /** Estimativa conservadora do custo máximo da chamada, em dólares. */
  estimatedUsd: number;
  /** Idade a partir da qual uma reserva sem liquidação é considerada abandonada (consumo desconhecido). Padrão do banco: 15 minutos. */
  staleAfter?: string;
};
export type ReserveResult =
  | { ok: true; usageId: string; monthCostUsd: number; budgetUsd: number | null }
  /** "unavailable": falha de comunicação, função ausente ou resposta inesperada (falha segura, sem chamada paga). */
  | { ok: false; outcome: Exclude<ReserveOutcome, "reserved"> | "unavailable"; usageId?: string };

export async function reserveAiUsage(supabase: Pick<SupabaseClient, "rpc">, input: ReserveInput): Promise<ReserveResult> {
  try {
    const { data, error } = await supabase.rpc("reserve_ai_usage", {
      p_agency_id: input.agencyId, p_client_id: input.clientId, p_user_id: input.userId, p_feature: input.feature, p_model: input.model,
      p_request_key: input.requestKey, p_scope_hash: input.scopeHash, p_estimated_usd: input.estimatedUsd, p_stale_after: input.staleAfter ?? "15 minutes",
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || typeof row.outcome !== "string" || !OUTCOMES.has(row.outcome)) return { ok: false, outcome: "unavailable" };
    if (row.outcome === "reserved") {
      if (typeof row.usage_id !== "string") return { ok: false, outcome: "unavailable" };
      return { ok: true, usageId: row.usage_id, monthCostUsd: Number(row.month_cost_usd), budgetUsd: row.budget_usd == null ? null : Number(row.budget_usd) };
    }
    return { ok: false, outcome: row.outcome as Exclude<ReserveOutcome, "reserved">, ...(typeof row.usage_id === "string" ? { usageId: row.usage_id } : {}) };
  } catch {
    return { ok: false, outcome: "unavailable" };
  }
}

export type SettleInput = {
  usageId: string; agencyId: string;
  /** completed: consumo conhecido; released: recusa certa sem consumo (custo 0); unknown: consumo desconhecido (mantém a estimativa). */
  outcome: "completed" | "released" | "unknown";
  status?: "ok" | "error" | "rejected_numbers";
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd?: number; providerRequestId?: string | null; verifierPassed?: boolean | null; factsHash?: string; model?: string;
};
export type SettleResult = { ok: true; outcome: "settled" | "already_settled"; costUsd: number | null; deltaUsd: number | null } | { ok: false; outcome: "not_found" | "invalid" | "error" };

async function settleOnce(supabase: Pick<SupabaseClient, "rpc">, input: SettleInput): Promise<SettleResult> {
  try {
    const { data, error } = await supabase.rpc("settle_ai_usage", {
      p_usage_id: input.usageId, p_agency_id: input.agencyId, p_outcome: input.outcome, p_status: input.status ?? null,
      p_input_tokens: input.tokens?.input ?? 0, p_output_tokens: input.tokens?.output ?? 0,
      p_cache_read_tokens: input.tokens?.cacheRead ?? 0, p_cache_write_tokens: input.tokens?.cacheWrite ?? 0,
      p_cost_usd: input.costUsd ?? null, p_request_id: input.providerRequestId ?? null, p_verifier_passed: input.verifierPassed ?? null,
      p_facts_hash: input.factsHash ?? null, p_model: input.model ?? null,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || typeof row.outcome !== "string") return { ok: false, outcome: "error" };
    if (row.outcome === "settled" || row.outcome === "already_settled") {
      return { ok: true, outcome: row.outcome, costUsd: row.cost_usd == null ? null : Number(row.cost_usd), deltaUsd: row.delta_usd == null ? null : Number(row.delta_usd) };
    }
    return { ok: false, outcome: row.outcome === "not_found" || row.outcome === "invalid" ? row.outcome : "error" };
  } catch {
    return { ok: false, outcome: "error" };
  }
}

/**
 * Liquida a reserva. A operação é idempotente no banco (a segunda liquidação não altera nada), por isso UMA nova tentativa depois de uma
 * falha de comunicação é segura: não duplica a contabilização. Se ainda falhar, a reserva continua no banco (conta pelo valor estimado)
 * e será tratada como consumo desconhecido a conciliar.
 */
export async function settleAiUsage(supabase: Pick<SupabaseClient, "rpc">, input: SettleInput): Promise<SettleResult> {
  const first = await settleOnce(supabase, input);
  return first.ok || first.outcome !== "error" ? first : settleOnce(supabase, input);
}

/** Limite superior PRÁTICO do custo de uma chamada, para a reserva (ver `reservationCostUsd` do chat). Arredonda para cima em 6 casas. */
export const ceilUsd = (value: number) => Math.ceil(value * 1e6) / 1e6;
