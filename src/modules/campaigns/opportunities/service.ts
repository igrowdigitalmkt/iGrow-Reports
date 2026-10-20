import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { aiAllowance, runDecisionCycle, type CycleDeps, type CycleResult } from "@/modules/agent-executor/decision-cycle";
import { decisionEngineEnabled, type DecisionModel } from "@/modules/agent-executor/decision-engine";
import {
  ANALYSIS_SCOPE, skipMessage, type AnalyzeResult, type OpportunityAvailability, type OpportunityJob, type OpportunityObservation, type OpportunityRun, type OpportunityState,
} from "./contracts";

type Service = SupabaseClient<Database>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Actor = { agencyId: string; userId: string; role: string };
export type OpportunityDeps = {
  service: Service;
  engineEnabled?: () => boolean;
  aiConfigured?: () => boolean;
  model?: () => DecisionModel;
  cycle?: (service: Service, scope: { agencyId: string; clientId: string }, deps: CycleDeps) => Promise<CycleResult>;
  allowance?: typeof aiAllowance;
  now?: () => Date;
};

const unavailable = (state: Exclude<OpportunityAvailability, { state: "available" }>["state"], message: string): OpportunityAvailability => ({ state, message });

/** Pré-condições da análise, todas no servidor. Cada falha tem um motivo próprio para a tela explicar. */
export async function opportunityAvailability(actor: Actor, clientId: string, deps: OpportunityDeps): Promise<OpportunityAvailability> {
  if (actor.role !== "owner" && actor.role !== "admin") return unavailable("unauthorized", "Somente proprietários e administradores podem pedir a análise operacional.");
  if (!UUID.test(clientId)) return unavailable("error", "Cliente inválido.");
  const { service } = deps;
  const { data: client } = await service.from("clients").select("id").eq("agency_id", actor.agencyId).eq("id", clientId).is("archived_at", null).maybeSingle();
  if (!client) return unavailable("error", "Cliente indisponível.");
  if (!(deps.engineEnabled ?? decisionEngineEnabled)()) return unavailable("engine_disabled", "A análise operacional ainda não está habilitada neste ambiente.");
  if (!(deps.aiConfigured ?? (() => !!process.env.ANTHROPIC_API_KEY))()) return unavailable("ai_unavailable", "A IA não está configurada neste ambiente.");
  const now = (deps.now?.() ?? new Date()).getTime();
  const [{ data: links }, { data: grants }] = await Promise.all([
    service.from("client_ad_accounts").select("ad_account_id").eq("agency_id", actor.agencyId).eq("client_id", clientId).eq("active", true),
    service.from("agent_delegations").select("ad_account_id,enabled,revoked_at,expires_at").eq("agency_id", actor.agencyId).eq("client_id", clientId),
  ]);
  if ((links?.length ?? 0) === 0) return unavailable("no_accounts", "Este cliente não tem conta de anúncios da Meta vinculada.");
  const linked = new Set((links ?? []).map(link => link.ad_account_id));
  const delegated = new Set((grants ?? []).filter(g => g.enabled && !g.revoked_at && Date.parse(g.expires_at) > now && linked.has(g.ad_account_id)).map(g => g.ad_account_id));
  if (delegated.size === 0) return unavailable("no_delegation", "Nenhuma conta deste cliente tem delegação vigente. A análise só roda em contas com um escopo delegado por um responsável.");
  const allowance = await (deps.allowance ?? aiAllowance)(service, actor.agencyId, clientId);
  if (allowance === "budget") return unavailable("ai_budget", "O orçamento mensal de IA desta organização foi atingido.");
  if (allowance !== "ok") return unavailable("ai_unavailable", "A IA não está disponível no plano ou nas configurações desta organização ou cliente.");
  return { state: "available", accounts: delegated.size };
}

/** Estado atual (análises recentes e propostas no ledger) deste cliente. Sempre filtrado por organização e cliente; só campos seguros. */
export async function loadOpportunityState(actor: Actor, clientId: string, deps: OpportunityDeps): Promise<OpportunityState> {
  const availability = await opportunityAvailability(actor, clientId, deps).catch((): OpportunityAvailability => unavailable("error", "Não foi possível verificar a disponibilidade agora."));
  const empty = { availability, runs: [], jobs: [], scope: ANALYSIS_SCOPE } satisfies OpportunityState;
  if (actor.role !== "owner" && actor.role !== "admin") return empty;
  if (!UUID.test(clientId)) return empty;
  const { service } = deps;
  const [runsResult, jobsResult] = await Promise.all([
    service.from("agent_analysis_runs").select("id,created_at,origin,ad_account_id,summary,observations,proposals,blocked,rejected")
      .eq("agency_id", actor.agencyId).eq("client_id", clientId).order("created_at", { ascending: false }).limit(4),
    service.from("agent_action_jobs").select("id,ad_account_id,action_type,meta_entity_id,daily_budget_minor,status,created_at,approval_expires_at,approved_by,failure_code,rationale")
      .eq("agency_id", actor.agencyId).eq("client_id", clientId).eq("execution_origin", "ai").order("created_at", { ascending: false }).limit(20),
  ]);
  const now = (deps.now?.() ?? new Date()).getTime();
  const observations = (value: unknown): OpportunityObservation[] => Array.isArray(value) ? value.flatMap(item => {
    const o = item as Record<string, unknown> | null;
    return o && typeof o.rationale === "string" && typeof o.name === "string"
      ? [{ name: o.name.slice(0, 200), level: o.level === "adset" || o.level === "ad" ? o.level : "campaign", rationale: o.rationale.slice(0, 600) } as OpportunityObservation] : [];
  }).slice(0, 12) : [];
  const runs: OpportunityRun[] = (runsResult.data ?? []).map(run => ({
    id: run.id, createdAt: run.created_at, origin: run.origin, accountId: run.ad_account_id, summary: run.summary,
    observations: observations(run.observations), proposals: run.proposals, blocked: run.blocked, rejected: run.rejected,
  }));
  const jobs: OpportunityJob[] = (jobsResult.data ?? []).map(job => ({
    id: job.id, accountId: job.ad_account_id, action: job.action_type, entityId: job.meta_entity_id,
    dailyBudgetMinor: job.daily_budget_minor === null ? null : Number(job.daily_budget_minor), status: job.status, createdAt: job.created_at,
    expiresAt: job.approval_expires_at ?? null, expired: job.status === "awaiting_approval" && (!job.approval_expires_at || Date.parse(job.approval_expires_at) <= now),
    approved: !!job.approved_by, failure: job.failure_code ?? null, reason: (job.rationale ?? "").slice(0, 600),
  }));
  return { availability, runs: runsResult.error ? [] : runs, jobs: jobsResult.error ? [] : jobs, scope: ANALYSIS_SCOPE };
}

/**
 * Pede a análise ao ciclo de decisão EXISTENTE. A IA só propõe: tudo entra como `awaiting_approval` (decision-bridge/queue) e só executa
 * com a aprovação humana específica. Aqui nada é aprovado, enfileirado para execução ou enviado à Meta.
 */
export async function analyzeOpportunities(actor: Actor, clientId: string, deps: OpportunityDeps): Promise<AnalyzeResult> {
  const availability = await opportunityAvailability(actor, clientId, deps);
  if (availability.state !== "available") {
    const state = await loadOpportunityState(actor, clientId, deps).catch(() => undefined);
    return { ok: false, code: availability.state, message: availability.message, ...(state ? { state } : {}) };
  }
  const model = deps.model ?? (() => { throw new Error("no_model"); });
  let result: CycleResult;
  try {
    result = await (deps.cycle ?? runDecisionCycle)(deps.service, { agencyId: actor.agencyId, clientId }, {
      model: model(), origin: "manual", requestedBy: actor.userId, enabled: true, ...(deps.now ? { now: deps.now } : {}),
    });
  } catch { return { ok: false, code: "error", message: "Não foi possível concluir a análise agora. Nada foi alterado nas campanhas." }; }
  const state = await loadOpportunityState(actor, clientId, deps);
  if (!result.ok) {
    const map: Record<string, Extract<AnalyzeResult, { ok: false }>["code"]> = { disabled: "engine_disabled", no_delegation: "no_delegation", ai_budget: "ai_budget", ai_unavailable: "ai_unavailable" };
    return { ok: false, code: map[result.reason] ?? "error", message: skipMessage(result.reason), state };
  }
  const skipped = result.accounts.flatMap(account => account.status === "skipped" ? [{ reason: account.reason, message: skipMessage(account.reason) }] : []);
  return { ok: true, summary: { analyzedAccounts: result.accounts.filter(account => account.status === "done").length, skipped }, state };
}
