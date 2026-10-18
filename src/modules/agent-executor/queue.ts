import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { ACTIONS, proposalSchema } from "./policy";

type Service = SupabaseClient<Database>;
type TrustedScope = {
  agencyId: string;
  clientId: string;
  /** UUID da conta interna, obtido de contexto autenticado no servidor. */
  adAccountId: string;
  /** ID estavel do ciclo de observacao; NAO fornecido pelo modelo. */
  observationId: string;
  /** Momento comprovado dos fatos coletados, nunca fabricado pelo modelo. */
  factsCollectedAt: string;
};
const decisionSchema = z.object({
  action: z.enum(ACTIONS),
  targetId: z.string().regex(/^[1-9]\d*$/),
  rationale: z.string().trim().min(10).max(2000),
  dailyBudgetMinor: z.number().int().positive().max(1_000_000_000_000).optional(),
}).strict();
export type StructuredMetaDecision = z.infer<typeof decisionSchema>;

export class AgentQueueError extends Error {
  constructor(readonly code: string) {
    super("Nao foi possivel registrar a decisao do agente.");
    this.name = "AgentQueueError";
  }
}
function reject(code: string): never { throw new AgentQueueError(code); }
async function move(service: Service, scope: TrustedScope, jobId: string, from: string, to: string) {
  const { data, error } = await service.from("agent_action_jobs")
    .update({ status: to }).eq("agency_id", scope.agencyId).eq("id", jobId)
    .eq("status", from).select("id").maybeSingle();
  if (error || !data) reject("queue_transition");
}

/**
 * Persiste proposta estruturada e autoriza/enfileira apenas apos validar
 * delegacao e vinculo atuais. Nao e endpoint; decisao so entra via server.
 * O worker reavalia tudo e faz GET na Meta ANTES de qualquer POST.
 */
export async function stageMetaDecision(
  service: Service, scope: TrustedScope, decision: unknown, now: Date = new Date(),
): Promise<{ id: string; deduplicated: boolean }> {
  const parsed = decisionSchema.safeParse(decision);
  const trusted = z.object({
    agencyId: z.uuid(), clientId: z.uuid(), adAccountId: z.uuid(),
    observationId: z.uuid(), factsCollectedAt: z.iso.datetime({ offset: true }),
  }).strict().safeParse(scope);
  if (!parsed.success || !trusted.success || !Number.isFinite(now.getTime())) reject("invalid_decision");
  const item = parsed.data, ctx = trusted.data;
  // Primeiro corte: somente pausas. Resume/orcamento aguardam cobertura
  // financeira verificada na API, nao apenas autorizacao declarada.
  if (!item.action.startsWith("pause_")) reject("financial_inventory_pending");
  const age = now.getTime() - Date.parse(ctx.factsCollectedAt);
  if (age < 0 || age > 60 * 60_000) reject("stale_facts");
  if (item.dailyBudgetMinor !== undefined) reject("unexpected_budget");
  const [{ data: enabled, error: eGate }, { data: link, error: eLink },
    { data: grant, error: eGrant }, { data: account, error: eAccount }] = await Promise.all([
    service.rpc("agent_meta_execution_allowed", { p_agency_id: ctx.agencyId }),
    service.from("client_ad_accounts").select("active")
      .eq("agency_id", ctx.agencyId).eq("client_id", ctx.clientId).eq("ad_account_id", ctx.adAccountId).single(),
    service.from("agent_delegations").select("*")
      .eq("agency_id", ctx.agencyId).eq("client_id", ctx.clientId).eq("ad_account_id", ctx.adAccountId).single(),
    service.from("meta_ad_accounts").select("external_id,currency,meta_connection_id,account_status")
      .eq("agency_id", ctx.agencyId).eq("id", ctx.adAccountId).is("archived_at", null).single(),
  ]);
  if (eGate || enabled !== true) reject("commercial_gate");
  if (eLink || !link?.active || eGrant || !grant || eAccount || !account) reject("missing_binding");
  if (!grant.enabled || grant.revoked_at || Date.parse(grant.expires_at) <= now.getTime()
    || !grant.allowed_actions.includes(item.action) || grant.currency !== account.currency
    || !grant.granted_by || !/^act_[1-9]\d*$/.test(account.external_id)
    || !["1", "ACTIVE"].includes(account.account_status ?? "")) reject("delegation_ineligible");
  const [{ data: granter }, { data: connection }] = await Promise.all([
    service.from("agency_users").select("role")
      .eq("agency_id", ctx.agencyId).eq("user_id", grant.granted_by).single(),
    service.from("meta_connections").select("id,integration_id,scopes,connected_at")
      .eq("agency_id", ctx.agencyId).eq("id", account.meta_connection_id)
      .eq("client_id", ctx.clientId).single(),
  ]);
  if ((granter?.role !== "owner" && granter?.role !== "admin")
    || !connection?.connected_at || !connection.scopes.includes("ads_management")) reject("permission_denied");
  const { data: integration } = await service.from("integrations").select("connection_status,health_status")
    .eq("agency_id", ctx.agencyId).eq("id", connection.integration_id)
    .eq("provider", "meta").single();
  if (integration?.connection_status !== "connected" || integration.health_status === "error") reject("integration_offline");

  const id = randomUUID();
  const proposal = proposalSchema.safeParse({
    actionId: id, action: item.action, targetId: item.targetId,
    adAccountId: account.external_id, factsCollectedAt: ctx.factsCollectedAt, rationale: item.rationale,
  });
  if (!proposal.success) reject("invalid_proposal");
  const idempotencyKey = createHash("sha256").update(JSON.stringify([
    ctx.agencyId, ctx.clientId, ctx.adAccountId, ctx.observationId,
    item.action, item.targetId, item.dailyBudgetMinor ?? null,
  ])).digest("hex");

  const { error } = await service.from("agent_action_jobs").insert({
    id, agency_id: ctx.agencyId, client_id: ctx.clientId, ad_account_id: ctx.adAccountId,
    delegation_id: grant.id, idempotency_key: idempotencyKey,
    action_type: item.action, meta_entity_id: item.targetId,
    facts_collected_at: ctx.factsCollectedAt, rationale: item.rationale,
  });
  if (error) {
    // Somente um registro realmente existente com a mesma chave e tratado
    // como deduplicacao; outros erros de FK/unique sao bloqueantes.
    if (error.code === "23505") {
      const { data: existing } = await service.from("agent_action_jobs").select("id")
        .eq("agency_id", ctx.agencyId).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (existing) return { id: existing.id, deduplicated: true };
    }
    reject("job_insert_failed");
  }
  await move(service, ctx, id, "proposed", "authorized");
  await move(service, ctx, id, "authorized", "queued");
  return { id, deduplicated: false };
}
