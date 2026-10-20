import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_MODEL, estimateCostUsd } from "@/modules/ai/guarded-text";
import { reserveAiUsage, settleAiUsage, type ReserveResult } from "@/modules/ai/reservation";
import { CAMPAIGN_CHAT_FEATURE } from "./gate";
import type { ModelUsage } from "./handler";

// Consumo do chat de Campanhas: reserva e liquidação ATÔMICAS no banco (src/modules/ai/reservation.ts) na mesma tabela e cota mensal da IA
// de texto (ai_usage), com a categoria própria campaign_chat. O gasto de IA nada tem a ver com o investimento publicitário: nada aqui
// autoriza alterar campanhas.
//
// As proteções em memória abaixo (um espaço por usuário, identificador de solicitação, disjuntor, cache da sonda) são COMPLEMENTARES e
// valem por instância do servidor. A decisão de reservar orçamento e a idempotência entre instâncias são do PostgreSQL.

export type ChatUsageStatus = "ok" | "error" | "rejected_numbers";

/** Hash do escopo autorizado da solicitação (cliente + contexto com contas, entidade e período): o requestId não serve para outro escopo. */
export const chatScopeHash = (clientId: string, contextKey: string) => createHash("sha256").update(`${clientId}|${contextKey}`).digest("hex").slice(0, 32);

export type ChatReservationInput = { agencyId: string; clientId: string; userId: string; requestId: string; contextKey: string; estimatedUsd: number };
export function reserveCampaignChat(supabase: Pick<SupabaseClient, "rpc">, input: ChatReservationInput): Promise<ReserveResult> {
  return reserveAiUsage(supabase, {
    agencyId: input.agencyId, clientId: input.clientId, userId: input.userId, feature: CAMPAIGN_CHAT_FEATURE, model: AI_MODEL,
    requestKey: input.requestId, scopeHash: chatScopeHash(input.clientId, input.contextKey), estimatedUsd: input.estimatedUsd,
  });
}

export type ChatSettlement = {
  usageId: string; agencyId: string; clientId: string;
  /** completed: consumo conhecido; released: recusa certa sem consumo; unknown: consumo desconhecido (mantém a estimativa). */
  outcome: "completed" | "released" | "unknown";
  status?: ChatUsageStatus; usage: ModelUsage | null; factsHash: string; verifierPassed: boolean | null;
};

// Disjuntor da liquidação: se liquidar falhar, novas chamadas pagas ficam suspensas até a janela passar. Depois dela a próxima chamada
// serve de teste: se a liquidação falhar de novo, o disjuntor reabre.
const ACCOUNTING_COOLDOWN_MS = 10 * 60_000;
let accountingBlockedUntil = 0;
export const markAccountingFailure = (now = Date.now()) => { accountingBlockedUntil = now + ACCOUNTING_COOLDOWN_MS; };
export const accountingHealthy = (now = Date.now()) => now >= accountingBlockedUntil;
export const resetAccountingCircuit = () => { accountingBlockedUntil = 0; };

/**
 * Liquida a reserva (idempotente no banco; uma nova tentativa só em falha de comunicação). Falha NÃO é tratada como sucesso: devolve
 * false, abre o disjuntor e deixa no log tudo para conciliar (tokens, id do provedor, hash dos fatos; nunca texto nem credenciais).
 * A reserva continua no banco, contando pelo valor estimado, e será tratada como consumo desconhecido a conciliar.
 */
export async function settleCampaignChat(supabase: Pick<SupabaseClient, "rpc">, settlement: ChatSettlement): Promise<boolean> {
  const tokens = settlement.usage ? { input: settlement.usage.inputTokens, output: settlement.usage.outputTokens, cacheRead: settlement.usage.cacheReadTokens, cacheWrite: settlement.usage.cacheWriteTokens } : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const costUsd = estimateCostUsd(tokens);
  const result = await settleAiUsage(supabase, {
    usageId: settlement.usageId, agencyId: settlement.agencyId, outcome: settlement.outcome,
    ...(settlement.outcome === "completed" ? { status: settlement.status ?? "error", tokens, costUsd, providerRequestId: settlement.usage?.requestId ?? null, model: settlement.usage?.model } : {}),
    verifierPassed: settlement.verifierPassed, factsHash: settlement.factsHash,
  });
  if (result.ok) return true;
  console.error("campaign_chat settlement_failed", JSON.stringify({
    usageId: settlement.usageId, agencyId: settlement.agencyId, clientId: settlement.clientId, outcome: settlement.outcome, status: settlement.status ?? null,
    reason: result.outcome, factsHash: settlement.factsHash, providerRequestId: settlement.usage?.requestId ?? null, inputTokens: tokens.input,
    outputTokens: tokens.output, cacheReadTokens: tokens.cacheRead, cacheWriteTokens: tokens.cacheWrite, estimatedCostUsd: costUsd,
    possibleCharge: settlement.outcome !== "released", reservationKept: true,
  }));
  markAccountingFailure();
  return false;
}

// Uma chamada por vez para cada usuário, com intervalo mínimo: evita cliques repetidos e simultâneos. Vale por instância do servidor
// (melhor esforço); a idempotência e o orçamento entre instâncias são da reserva no banco.
const MIN_INTERVAL_MS = 2_000;
const STALE_SLOT_MS = 90_000;
const PRUNE_AFTER_MS = 10 * 60_000;
const MAX_TRACKED = 500;
const slots = new Map<string, number>();
const lastStart = new Map<string, number>();
const prune = (now: number) => {
  if (lastStart.size <= MAX_TRACKED) return;
  for (const [key, at] of lastStart) if (now - at > PRUNE_AFTER_MS) { lastStart.delete(key); slots.delete(key); }
};
export function acquireChatSlot(key: string, now = Date.now()): (() => void) | null {
  const running = slots.get(key);
  if (running !== undefined && now - running < STALE_SLOT_MS) return null;
  if (now - (lastStart.get(key) ?? 0) < MIN_INTERVAL_MS) return null;
  prune(now);
  slots.set(key, now);
  lastStart.set(key, now);
  return () => { slots.delete(key); };
}
export const resetChatSlots = () => { slots.clear(); lastStart.clear(); };

// Rejeição antecipada da MESMA solicitação nesta instância (barata, antes de ler dados). Entre instâncias quem garante é o índice único
// da reserva no banco.
const REQUEST_TTL_MS = 5 * 60_000;
const claimed = new Map<string, number>();
export function claimRequestId(key: string, now = Date.now()): boolean {
  const seen = claimed.get(key);
  if (seen !== undefined && now - seen < REQUEST_TTL_MS) return false;
  if (claimed.size > MAX_TRACKED) for (const [id, at] of claimed) if (now - at >= REQUEST_TTL_MS) claimed.delete(id);
  claimed.set(key, now);
  return true;
}
export const resetClaimedRequests = () => claimed.clear();

// Sondas do banco do ambiente: (1) a categoria campaign_chat é aceita em ai_usage.feature; (2) a estrutura de reservas está completa.
// Sem as funções (migrations não aplicadas) ou diante de qualquer erro, a resposta é "não": o chat falha de forma segura.
const PROBE_TTL_MS = 60_000;
const probes = new Map<string, { value: boolean; expires: number }>();
export const resetFeatureProbe = () => probes.clear();
async function probe(supabase: Pick<SupabaseClient, "rpc"> | null, name: string, args: Record<string, unknown>, now: number): Promise<boolean> {
  if (!supabase) return false;
  const cached = probes.get(name);
  if (cached && cached.expires > now) return cached.value;
  let value = false;
  try {
    const { data, error } = await supabase.rpc(name, args);
    value = !error && data === true;
  } catch { value = false; }
  probes.set(name, { value, expires: now + PROBE_TTL_MS });
  return value;
}
export const campaignChatSupportedByDatabase = (supabase: Pick<SupabaseClient, "rpc"> | null, now = Date.now()) =>
  probe(supabase, "ai_usage_supports_feature", { p_feature: CAMPAIGN_CHAT_FEATURE }, now);
export const reservationsReadyInDatabase = (supabase: Pick<SupabaseClient, "rpc"> | null, now = Date.now()) =>
  probe(supabase, "ai_reservations_ready", {}, now);

/** Consumo DESCONHECIDO sem reserva possível (não deveria ocorrer): vai ao log para conciliação, nunca como custo zero. */
export function reportUnknownConsumption(info: { agencyId: string; clientId: string; reason: string; factsHash: string }) {
  console.error("campaign_chat consumption_unknown", JSON.stringify({ ...info, possibleCharge: true }));
}
