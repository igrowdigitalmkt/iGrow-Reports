"use server";

import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { approvalFingerprint } from "./financial-approval";

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
  return (data ?? []).map((row) => ({
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
  await decideAgentFinancialAction({
    jobId: String(formData.get("jobId") ?? ""),
    approvalFingerprint: String(formData.get("approvalFingerprint") ?? ""),
    approve: decision === "approve",
  });
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
