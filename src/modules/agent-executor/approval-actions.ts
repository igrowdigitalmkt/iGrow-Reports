"use server";

import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { approvalFingerprint } from "./financial-approval";
import { executeQueuedJobNow } from "./scheduler";

function verifyApprover(role: string) {
  if (role !== "owner" && role !== "admin")
    throw new Error("Somente o proprietario ou administrador pode aprovar alteracoes financeiras da IA.");
}

/**
 * Dados para tela de aprovacao: APENAS usuario autenticado owner/admin.
 * Nenhuma credencial Meta nem informacao de outras organizacoes sai daqui.
 */
export async function listPendingAgentFinancialApprovals() {
  const ctx = await requireAgencyContext();
  verifyApprover(ctx.role);
  const { data, error } = await ctx.supabase.from("agent_action_jobs")
    .select("id,agency_id,client_id,ad_account_id,action_type,meta_entity_id,daily_budget_minor,rationale,created_at,approval_expires_at,execution_origin")
    .eq("agency_id", ctx.agency.id).eq("execution_origin", "ai")
    .eq("status", "awaiting_approval").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("Nao foi possivel consultar as solicitacoes de aprovacao.");
  // Nome da campanha/conjunto (do cache de metricas) so para o usuario saber O QUE esta aprovando.
  const ids = [...new Set((data ?? []).map(row => row.meta_entity_id))];
  const { data: named } = ids.length ? await ctx.supabase.from("meta_daily_insights")
    .select("external_entity_id,entity_name,insight_date").in("external_entity_id", ids)
    .order("insight_date", { ascending: false }).limit(500) : { data: [] };
  const names = new Map<string, string>();
  for (const row of named ?? []) if (row.entity_name && !names.has(row.external_entity_id)) names.set(row.external_entity_id, row.entity_name);
  return (data ?? []).map((row) => ({
    entityName: names.get(row.meta_entity_id) ?? null,
    id: row.id, clientId: row.client_id, accountId: row.ad_account_id,
    action: row.action_type, metaEntityId: row.meta_entity_id,
    dailyBudgetMinor: row.daily_budget_minor, rationale: row.rationale,
    requestedAt: row.created_at, expiresAt: row.approval_expires_at,
    expired: !row.approval_expires_at || Date.parse(row.approval_expires_at) <= Date.now(),
    approvalFingerprint: approvalFingerprint(row),
  }));
}

/**
 * Nao aceita agencia, token, permissoes, conta ou valores do navegador.
 * Supabase autenticado executa RPC com auth.uid; service_role NAO pode aprovar.
 */
export async function submitAgentFinancialApproval(formData: FormData) {
  const decision = String(formData.get("decision") ?? "");
  if (decision !== "approve" && decision !== "reject")
    throw new Error("Decisao de aprovacao invalida.");
  const decided = await decideAgentFinancialAction({
    jobId: String(formData.get("jobId") ?? ""),
    approvalFingerprint: String(formData.get("approvalFingerprint") ?? ""),
    approve: decision === "approve",
  });
  // Aprovado => executa agora (a aprovacao vale 15 min). O ledger registra o resultado; erros nunca vazam.
  if (decided.status === "queued") {
    const service = createSupabaseServiceClient();
    const ctx = await requireAgencyContext();
    if (service) await executeQueuedJobNow(service, { agencyId: ctx.agency.id, jobId: decided.jobId });
  }
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/agente/aprovacoes");
}

export async function decideAgentFinancialAction(input: unknown) {
  const parsed = z.object({
    jobId: z.uuid(), approvalFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    approve: z.boolean(),
  }).strict().safeParse(input);
  if (!parsed.success) throw new Error("Confirmacao invalida.");
  const ctx = await requireAgencyContext();
  verifyApprover(ctx.role);
  const { data, error } = await ctx.supabase.rpc("agent_decide_financial_action", {
    p_agency_id: ctx.agency.id, p_job_id: parsed.data.jobId,
    p_expected_fingerprint: parsed.data.approvalFingerprint,
    p_approve: parsed.data.approve,
  });
  if (error || (data !== "queued" && data !== "rejected"))
    throw new Error("Nao foi possivel concluir a aprovacao. Atualize a solicitacao.");
  return { status: data, jobId: parsed.data.jobId };
}

const FAILURE_LABELS: Record<string, string> = {
  preflight_denied: "Bloqueada antes de enviar: alguma verificacao de seguranca falhou.",
  policy_blocked: "Bloqueada pela politica no momento da execucao.",
  provider_uncertain: "A Meta nao confirmou; aguardando conciliacao.",
  worker_uncertain: "Resultado incerto; aguardando conciliacao.",
  reconciled_not_applied: "Conferido na Meta: a alteracao nao foi aplicada.",
  reconciled_not_sent: "Conferido: a alteracao nunca foi enviada.",
  user_rejected: "Recusada por voce.",
  account_busy: "Havia outra alteracao em andamento na conta.",
  executor_disabled: "Execucao desabilitada no ambiente; nada foi alterado na Meta.",
};

/** Historico recente do agente para a organizacao (RLS: owner/admin/editor). Sem tokens nem dados de outras organizacoes. */
export async function listRecentAgentActivity() {
  const ctx = await requireAgencyContext();
  verifyApprover(ctx.role);
  const { data, error } = await ctx.supabase.from("agent_action_jobs")
    .select("id,client_id,action_type,daily_budget_minor,status,execution_origin,failure_code,updated_at,after_state")
    .eq("agency_id", ctx.agency.id).neq("status", "awaiting_approval")
    .order("updated_at", { ascending: false }).limit(30);
  if (error) throw new Error("Nao foi possivel consultar o historico do agente.");
  return (data ?? []).map((row) => ({
    id: row.id, action: row.action_type, status: row.status, origin: row.execution_origin,
    dailyBudgetMinor: row.daily_budget_minor, updatedAt: row.updated_at,
    note: row.failure_code ? (FAILURE_LABELS[row.failure_code] ?? "Encerrada sem execucao.") : null,
    needsAttention: row.status === "needs_verification",
  }));
}
