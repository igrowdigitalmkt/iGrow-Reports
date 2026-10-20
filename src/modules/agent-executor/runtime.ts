import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMetaApiConfig } from "@/lib/env";
import type { Database } from "@/types/database";
import { loadAccessToken } from "@/modules/meta/server";
import { readBudgetInventory, type BudgetInventory } from "./financial-inventory";
import { MANUAL_MAX_INCREASE_PERCENT, delegationSchema, isBudgetSensitiveAction, isManualOnlyAction, proposalSchema, type AccountContext, type ActionProposal, type Delegation } from "./policy";

/**
 * O worker recebe SOMENTE agencyId + jobId. Todo o restante e resolvido
 * novamente no banco com service_role, nunca no modelo ou no browser.
 * Sem rota HTTP: habilitacao comercial e homologacao ainda sao obrigatorias.
 */
export class AgentContextError extends Error {
  constructor(readonly code: string) {
    super("Contexto de execucao indisponivel.");
    this.name = "AgentContextError";
  }
}

type Service = SupabaseClient<Database>;
export type AgentRuntime = {
  proposal: ActionProposal;
  delegation: Delegation;
  context: AccountContext;
  token: string;
  apiVersion: string;
  targetId: string;
};
export type RuntimeDeps = {
  now?: () => Date;
  apiVersion?: string;
  tokenLoader?: (service: Service, agencyId: string, integrationId: string, connectionId: string) => Promise<string>;
  permissionProbe?: (token: string, version: string) => Promise<boolean>;
  inventoryReader?: (token: string, adAccountId: string, version: string) => Promise<BudgetInventory>;
  /** Origem esperada do job. Padrao `ai`: o worker da IA NUNCA executa um job manual. */
  origin?: "ai" | "manual";
};

function deny(code: string): never { throw new AgentContextError(code); }
async function single<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
  code: string,
): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error || data == null) deny(code);
  return data as NonNullable<T>;
}

/** Somente GET; nunca infere ads_management da simples existencia em scopes. */
export async function probeMetaWritePermission(token: string, version: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!token.trim() || !/^v\d+\.\d+$/.test(version)) return false;
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${version}/me/permissions?fields=permission,status&limit=100`, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !("data" in body) || !Array.isArray(body.data)) return false;
    return body.data.some((item: unknown) => item !== null && typeof item === "object"
      && "permission" in item && item.permission === "ads_management"
      && "status" in item && item.status === "granted");
  } catch { return false; }
}

export async function resolveAgentRuntime(
  service: Service, identity: { agencyId: string; jobId: string }, deps: RuntimeDeps = {},
): Promise<AgentRuntime> {
  const now = deps.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) deny("invalid_clock");
  // Feature e assinatura sao avaliadas ANTES de carregar credenciais.
  // RPC obrigatoria (migration 002). Ausente/falha -> NEGAR.
  const { data: eligible, error: entitlementError } = await service.rpc("agent_meta_execution_allowed", {
    p_agency_id: identity.agencyId,
  });
  if (entitlementError || eligible !== true) deny("commercial_gate");

  const job = await single(service.from("agent_action_jobs").select("*")
    .eq("agency_id", identity.agencyId).eq("id", identity.jobId)
    .eq("status", "executing").single(), "job_not_claimed");
  if (job.policy_version !== 1) deny("unknown_policy_version");
  const origin = deps.origin ?? "ai";
  // Cada origem tem seu proprio caminho: uma acao manual nao e delegacao da IA e
  // um job da IA nunca pode ser executado como se fosse clique do usuario.
  if (job.execution_origin !== origin) deny("invalid_execution_origin");
  // Ações novas (renomear, anúncios) só existem para o clique manual: nunca para um job da IA (o banco também recusa).
  if (isManualOnlyAction(job.action_type) && origin !== "manual") deny("manual_only_action");
  let delegationRow: Database["public"]["Tables"]["agent_delegations"]["Row"] | null = null;
  if (origin === "ai") {
    if (!job.approved_by || !job.approved_at || !job.approval_expires_at
      || Date.parse(job.approval_expires_at) <= now.getTime()
      || Date.parse(job.approved_at) > now.getTime()
      || Date.parse(job.approved_at) < Date.parse(job.created_at)) deny("financial_approval_required");
    const approver = await single(service.from("agency_users").select("role")
      .eq("agency_id", identity.agencyId).eq("user_id", job.approved_by).single(), "approver_removed");
    if (approver.role !== "owner" && approver.role !== "admin") deny("approver_not_authorized");
    delegationRow = await single(service.from("agent_delegations").select("*")
      .eq("agency_id", identity.agencyId).eq("id", job.delegation_id ?? "")
      .eq("client_id", job.client_id).eq("ad_account_id", job.ad_account_id).single(), "no_delegation");
  } else {
    // Manual: o ato explicito e do usuario que solicitou, ainda owner/admin no momento da execucao.
    if (!job.requested_by) deny("missing_requester");
    const requester = await single(service.from("agency_users").select("role")
      .eq("agency_id", identity.agencyId).eq("user_id", job.requested_by).single(), "requester_removed");
    if (requester.role !== "owner" && requester.role !== "admin") deny("requester_not_authorized");
  }
  const link = await single(service.from("client_ad_accounts").select("active")
    .eq("agency_id", identity.agencyId).eq("client_id", job.client_id)
    .eq("ad_account_id", job.ad_account_id).single(), "missing_link");
  if (!link.active) deny("inactive_link");
  await single(service.from("clients").select("id").eq("agency_id", identity.agencyId)
    .eq("id", job.client_id).is("archived_at", null).single(), "archived_client");

  if (delegationRow) {
    if (!delegationRow.granted_by) deny("missing_granter");
    const granter = await single(service.from("agency_users").select("role")
      .eq("agency_id", identity.agencyId).eq("user_id", delegationRow.granted_by).single(), "granter_removed");
    if (granter.role !== "owner" && granter.role !== "admin") deny("granter_not_authorized");
  }

  const account = await single(service.from("meta_ad_accounts")
    .select("id,external_id,currency,account_status,meta_connection_id")
    .eq("agency_id", identity.agencyId).eq("id", job.ad_account_id)
    .is("archived_at", null).single(), "missing_meta_account");
  if (!/^act_[1-9]\d*$/.test(account.external_id)
    || (account.account_status !== "1" && account.account_status !== "ACTIVE")
    || (delegationRow && delegationRow.currency !== account.currency)) deny("meta_account_ineligible");
  const connection = await single(service.from("meta_connections")
    .select("id,agency_id,client_id,integration_id,scopes,connected_at")
    .eq("agency_id", identity.agencyId).eq("id", account.meta_connection_id)
    .eq("client_id", job.client_id).single(), "connection_not_bound");
  if (!connection.connected_at || !connection.scopes.includes("ads_management")) deny("connection_no_write_scope");
  const integration = await single(service.from("integrations")
    .select("id,connection_status,health_status")
    .eq("agency_id", identity.agencyId).eq("id", connection.integration_id)
    .eq("provider", "meta").single(), "missing_integration");
  if (integration.connection_status !== "connected" || integration.health_status === "error") deny("integration_offline");

  const proposal = proposalSchema.safeParse({
    actionId: job.id, action: job.action_type, targetId: job.meta_entity_id,
    adAccountId: account.external_id, factsCollectedAt: job.facts_collected_at,
    rationale: job.rationale,
    ...(job.new_name != null ? { newName: job.new_name } : {}),
    ...(job.daily_budget_minor !== null ? { dailyBudgetMinor: Number(job.daily_budget_minor) } : {}),
  });
  // Manual: envelope sintetico em memoria, derivado da propria solicitacao do usuario. Os tetos
  // financeiros da DELEGACAO DA IA nao se aplicam ao clique humano; as demais verificacoes
  // da politica (conta, titularidade, estado, frescor, permissao, inventario) continuam.
  const MAX = 1_000_000_000_000;
  const delegation = delegationRow ? delegationSchema.safeParse({
    agencyId: delegationRow.agency_id, clientId: delegationRow.client_id,
    adAccountId: account.external_id, enabled: delegationRow.enabled,
    revokedAt: delegationRow.revoked_at, expiresAt: delegationRow.expires_at,
    allowedActions: delegationRow.allowed_actions,
    maxAccountDailyBudgetMinor: Number(delegationRow.max_account_daily_budget_minor),
    maxEntityDailyBudgetMinor: Number(delegationRow.max_entity_daily_budget_minor),
    maxIncreaseMinorPerAction: Number(delegationRow.max_increase_minor_per_action),
    maxIncreasePercentPerAction: delegationRow.max_increase_percent_per_action,
  }) : delegationSchema.safeParse({
    agencyId: identity.agencyId, clientId: job.client_id, adAccountId: account.external_id,
    enabled: true, revokedAt: null, expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    allowedActions: [job.action_type], maxAccountDailyBudgetMinor: MAX, maxEntityDailyBudgetMinor: MAX,
    maxIncreaseMinorPerAction: MAX, maxIncreasePercentPerAction: MANUAL_MAX_INCREASE_PERCENT,
  });
  if (!proposal.success || !delegation.success) deny("invalid_record");
  if (!delegation.data.enabled || delegation.data.revokedAt
    || Date.parse(delegation.data.expiresAt) <= now.getTime()
    || !delegation.data.allowedActions.includes(proposal.data.action)) deny("delegation_inactive");

  const apiVersion = deps.apiVersion ?? getMetaApiConfig()?.apiVersion;
  if (!apiVersion || !/^v\d+\.\d+$/.test(apiVersion)) deny("meta_config");
  let token: string;
  try {
    token = await (deps.tokenLoader ?? loadAccessToken)(
      service, identity.agencyId, integration.id, connection.id,
    );
  } catch { return deny("token_unavailable"); }
  if (!token || !(await (deps.permissionProbe ?? probeMetaWritePermission)(token, apiVersion))) deny("meta_permission");

  // Retomar e orcamento dependem de inventario financeiro INTEGRAL lido agora na Meta.
  // Pausar nao aumenta gasto: dispensa a leitura. Falha/cobertura incompleta => politica nega.
  const needsInventory = isBudgetSensitiveAction(proposal.data.action);
  const inventory: BudgetInventory = needsInventory
    ? await (deps.inventoryReader ?? ((t, a, v) => readBudgetInventory(t, a, { apiVersion: v })))(token, account.external_id, apiVersion)
    : { confirmedActiveDailyBudgetMinor: null, coverageComplete: false, gaps: [] };

  const context: AccountContext = {
    agencyId: identity.agencyId, clientId: job.client_id, adAccountId: account.external_id,
    currency: account.currency, hasWritePermission: true, userMayDelegate: true,
    commercialAccessActive: true, metaConnectionActive: true,
    confirmedActiveDailyBudgetMinor: inventory.coverageComplete ? inventory.confirmedActiveDailyBudgetMinor : null,
    budgetCoverageComplete: inventory.coverageComplete,
  };
  return { proposal: proposal.data, delegation: delegation.data, context, token, apiVersion, targetId: job.meta_entity_id };
}
