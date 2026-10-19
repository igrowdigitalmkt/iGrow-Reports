import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHierarchy } from "@/modules/client-portal/analytics-hierarchy";
import { DEFAULT_MONTHLY_BUDGET_USD } from "@/modules/ai/defaults";
import { AI_MODEL, estimateCostUsd, parseAiEntitlement } from "@/modules/ai/guarded-text";
import type { Database } from "@/types/database";
import { stageValidatedDecisions, type StageOutcome } from "./decision-bridge";
import { decisionEngineEnabled, runDecisionEngine, type DecisionModel } from "./decision-engine";
import { buildDecisionFacts } from "./decision-facts";
import { readLiveEntityState, type LiveEntityState } from "./decision-live-state";

type Service = SupabaseClient<Database>;

export type CycleDeps = {
  model: DecisionModel;
  now?: () => Date;
  enabled?: boolean;
  /** Quem pediu a analise (manual) ou o agendador; so para o historico. */
  origin?: "manual" | "scheduled";
  requestedBy?: string | null;
  liveState?: (scope: { agencyId: string; clientId: string; adAccountId: string }, ids: string[]) => Promise<Map<string, LiveEntityState> | null>;
};
export type AccountCycleResult =
  | { adAccountId: string; status: "skipped"; reason: string }
  | { adAccountId: string; status: "done"; summary: string; stages: StageOutcome[]; observations: number; rejected: number; rejectedReasons: string[]; rejectedDetails: string[] };
export type CycleResult =
  | { ok: false; reason: "disabled" | "no_delegation" | "ai_unavailable" | "ai_budget" }
  | { ok: true; accounts: AccountCycleResult[] };

const WINDOW_DAYS = 14;
const day = (date: Date, offset: number) => new Date(date.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
/** UUID estavel derivado dos fatos: mesmos fatos => mesma chave de idempotencia na fila. */
function observationIdFrom(hash: string): string {
  const h = hash.slice(0, 32).split("");
  h[12] = "4"; h[16] = "8";
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Cota e direitos de IA: mesmas fontes de `runGuardedGeneration` (plano, liga/desliga e
 * orcamento mensal). Duplicado de proposito para nao alterar o caminho de texto em producao;
 * qualquer duvida ou erro NEGA.
 * TODO(refactor): extrair para modulo unico quando a IA de texto puder ser tocada com seguranca.
 */
async function aiAllowance(service: Service, agencyId: string, clientId: string): Promise<"ok" | "unavailable" | "budget"> {
  const [agency, client, month, entitlement] = await Promise.all([
    service.from("ai_settings").select("enabled,monthly_budget_usd").eq("agency_id", agencyId).maybeSingle(),
    service.from("ai_client_settings").select("enabled").eq("client_id", clientId).maybeSingle(),
    service.rpc("ai_month_cost", { p_agency_id: agencyId }),
    service.rpc("agency_ai_entitlement", { p_agency_id: agencyId }),
  ]);
  const plan = parseAiEntitlement(entitlement.data);
  if (agency.error || client.error || month.error || month.data == null || entitlement.error || !plan) return "unavailable";
  if (!plan.allowed || !(agency.data?.enabled ?? true) || !(client.data?.enabled ?? true)) return "unavailable";
  const budget = Math.min(Number(agency.data?.monthly_budget_usd ?? plan.budgetUsd ?? DEFAULT_MONTHLY_BUDGET_USD), plan.budgetUsd ?? Infinity);
  return Number(month.data) >= budget ? "budget" : "ok";
}

export async function runDecisionCycle(
  service: Service, scope: { agencyId: string; clientId: string }, deps: CycleDeps,
): Promise<CycleResult> {
  if (!(deps.enabled ?? decisionEngineEnabled())) return { ok: false, reason: "disabled" };
  const now = deps.now?.() ?? new Date();

  // So analisa contas com delegacao vigente: sem delegacao, nao ha gasto de IA.
  const { data: grants } = await service.from("agent_delegations").select("ad_account_id,enabled,revoked_at,expires_at")
    .eq("agency_id", scope.agencyId).eq("client_id", scope.clientId);
  const accountIds = (grants ?? []).filter(g => g.enabled && !g.revoked_at && Date.parse(g.expires_at) > now.getTime())
    .map(g => g.ad_account_id);
  if (accountIds.length === 0) return { ok: false, reason: "no_delegation" };

  const allowance = await aiAllowance(service, scope.agencyId, scope.clientId);
  if (allowance !== "ok") return { ok: false, reason: allowance === "budget" ? "ai_budget" : "ai_unavailable" };

  const range = { from: day(now, -WINDOW_DAYS), to: day(now, -1) };
  const before = { from: day(now, -2 * WINDOW_DAYS), to: day(now, -WINDOW_DAYS - 1) };
  const [current, previous, profile] = await Promise.all([
    service.rpc("service_client_hierarchy", { p_client_id: scope.clientId, p_date_from: range.from, p_date_to: range.to }),
    service.rpc("service_client_hierarchy", { p_client_id: scope.clientId, p_date_from: before.from, p_date_to: before.to }),
    service.from("client_profiles").select("goal").eq("client_id", scope.clientId).maybeSingle(),
  ]);
  const entities = current.error ? [] : normalizeHierarchy(current.data);
  const previousEntities = previous.error ? [] : normalizeHierarchy(previous.data);
  const goal = profile.data?.goal?.trim();
  const live = deps.liveState ?? ((s, ids) => readLiveEntityState(service, s, ids));

  const accounts: AccountCycleResult[] = [];
  for (const adAccountId of [...new Set(accountIds)]) {
    const skip = (reason: string) => accounts.push({ adAccountId, status: "skipped", reason });
    const own = entities.filter(e => e.accountId === adAccountId && (e.level === "campaign" || e.level === "adset"));
    if (own.length === 0) { skip("no_metrics"); continue; }
    // Sem leitura AO VIVO da Meta nao ha decisao: metricas em cache nao provam estado nem orcamento.
    const state = await live({ ...scope, adAccountId }, own.map(e => e.id));
    if (!state) { skip("live_state_unavailable"); continue; }
    const confirmed = own.flatMap(e => {
      const s = state.get(e.id);
      return s?.effectiveStatus ? [{ ...e, effectiveStatus: s.effectiveStatus }] : [];
    });
    const budgets = new Map(confirmed.flatMap(e => {
      const b = state.get(e.id)?.dailyBudgetMinor;
      return b == null ? [] : [[`${e.accountId}:${e.id}`, b] as const];
    }));
    const currency = confirmed[0]?.currency;
    if (!currency) { skip("no_confirmed_entities"); continue; }

    const collectedAt = now.toISOString();
    const facts = buildDecisionFacts({
      entities: confirmed, previousEntities: previousEntities.filter(e => e.accountId === adAccountId),
      currency, periodFrom: range.from, periodTo: range.to, collectedAt, goals: goal ? [goal] : [], budgetsMinor: budgets,
    });
    const result = await runDecisionEngine({ model: deps.model, enabled: true }, facts, now);

    // Registra o custo mesmo quando a saida e rejeitada: o gasto de tokens ocorreu.
    const usage = result.ok ? result.usage : undefined;
    const inTok = usage?.inputTokens ?? 0, outTok = usage?.outputTokens ?? 0;
    const { error } = await service.from("ai_usage").insert({
      agency_id: scope.agencyId, client_id: scope.clientId, user_id: null, feature: "agent_decision", model: AI_MODEL,
      status: result.ok ? "ok" : result.reason === "unverified_numbers" ? "rejected_numbers" : "error",
      input_tokens: inTok, output_tokens: outTok, cost_usd: estimateCostUsd({ input: inTok, output: outTok, cacheRead: 0, cacheWrite: 0 }),
      verifier_passed: result.ok ? true : null, facts_hash: facts.factsHash.slice(0, 32),
      source_ref: `${range.from}..${range.to}`, request_id: result.ok ? (result.requestId?.slice(0, 120) ?? null) : null,
    });
    if (error) console.error("agent_decision ai_usage insert failed", error.code);
    if (!result.ok) { skip(result.detail ? `${result.reason}:${result.detail}` : result.reason); continue; }

    const stages = await stageValidatedDecisions(service, {
      ...scope, observationId: observationIdFrom(facts.factsHash), factsCollectedAt: collectedAt,
    }, result.decision, now);
    // Historico da analise (texto ja validado: numeros vem dos fatos). Falha ao gravar nao derruba o ciclo.
    const { error: historyError } = await service.from("agent_analysis_runs").insert({
      agency_id: scope.agencyId, client_id: scope.clientId, ad_account_id: adAccountId,
      origin: deps.origin ?? "scheduled", requested_by: deps.requestedBy ?? null,
      summary: result.decision.summary.slice(0, 2000),
      observations: result.decision.observations.map(o => {
        const target = facts.targets.get(o.targetRef);
        return { name: target?.name ?? "", level: target?.level ?? "campaign", rationale: o.rationale.slice(0, 600) };
      }),
      proposals: stages.filter(st => st.status === "awaiting_approval").length,
      blocked: stages.filter(st => st.status === "blocked").length,
      rejected: result.decision.rejected.length, rejected_reasons: result.decision.rejected.map(r => r.reason),
      facts_hash: facts.factsHash.slice(0, 64),
    });
    if (historyError) console.error("agent_analysis_runs insert failed", historyError.code);
    accounts.push({
      adAccountId, status: "done", summary: result.decision.summary, stages,
      observations: result.decision.observations.length, rejected: result.decision.rejected.length,
      rejectedReasons: result.decision.rejected.map(r => r.reason),
      rejectedDetails: result.decision.rejected.flatMap(r => r.detail ? [r.detail] : []),
    });
  }
  return { ok: true, accounts };
}
