"use server";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { MANUAL_ACTIONS, isManualOnlyAction, isRenameAction, validateEntityName } from "./policy";
import { executeQueuedJobNow } from "./scheduler";

/**
 * Operacao MANUAL de campanha: o clique do usuario autenticado e o ato explicito. Ledger
 * proprio (execution_origin = 'manual'), mesma fila, mesma trava de uma mutacao por conta,
 * mesma auditoria. Nunca se passa por aprovacao de IA e o worker da IA nao a executa.
 * Exige proprietario/administrador; o runtime revalida isso na hora da execucao.
 */
const inputSchema = z.object({
  requestId: z.uuid(),
  clientId: z.uuid(),
  adAccountId: z.uuid(),
  action: z.enum(MANUAL_ACTIONS),
  targetId: z.string().regex(/^[1-9]\d*$/),
  dailyBudgetMinor: z.number().int().positive().max(1_000_000_000_000).optional(),
  /** Novo nome (somente rename_*): validado aqui, pelo schema da proposta e pelo banco. */
  newName: z.string().max(400).optional(),
  note: z.string().trim().max(300).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.action.startsWith("set_") !== (v.dailyBudgetMinor !== undefined))
    ctx.addIssue({ code: "custom", path: ["dailyBudgetMinor"], message: "Orcamento incompativel com a acao." });
  if (isRenameAction(v.action) !== (v.newName !== undefined) || (v.newName !== undefined && !validateEntityName(v.newName).ok))
    ctx.addIssue({ code: "custom", path: ["newName"], message: "Nome incompativel com a acao." });
});

export type ManualChangeResult =
  | { ok: true; jobId: string; execution: string }
  | { ok: false; message: string; code: string };
const fail = (message: string, code = "failed"): ManualChangeResult => ({ ok: false, message, code });

export async function requestManualMetaChange(input: unknown): Promise<ManualChangeResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Dados da alteracao invalidos.");
  const ctx = await requireAgencyContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") return fail("Somente proprietario ou administrador pode alterar campanhas.");
  const service = createSupabaseServiceClient();
  if (!service) return fail("Servico indisponivel neste ambiente.");
  const v = parsed.data, agencyId = ctx.agency.id;

  const { data: enabled } = await service.rpc("agent_meta_execution_allowed", { p_agency_id: agencyId });
  if (enabled !== true) return fail("A execucao de alteracoes ainda nao esta habilitada para esta organizacao.", "gate_closed");
  const [{ data: client }, { data: link }, { data: account }] = await Promise.all([
    service.from("clients").select("id").eq("agency_id", agencyId).eq("id", v.clientId).is("archived_at", null).maybeSingle(),
    service.from("client_ad_accounts").select("active").eq("agency_id", agencyId)
      .eq("client_id", v.clientId).eq("ad_account_id", v.adAccountId).maybeSingle(),
    service.from("meta_ad_accounts").select("id").eq("agency_id", agencyId).eq("id", v.adAccountId).is("archived_at", null).maybeSingle(),
  ]);
  if (!client || !link?.active || !account) return fail("Cliente ou conta de anuncios indisponivel.");

  // Acoes novas (renomear, anuncios) so sao aceitas quando o banco as suporta DE FATO (migracao aplicada); antes disso ficam desabilitadas.
  if (isManualOnlyAction(v.action)) {
    const { data: supported, error: probeError } = await service.rpc("agent_manual_extended_actions_supported");
    if (probeError || supported !== true) return fail("Esta operacao ainda nao esta habilitada neste ambiente (atualizacao do banco pendente). Nada foi alterado na Meta.", "extended_unsupported");
  }

  const id = randomUUID();
  const note = v.note ? `: ${v.note}` : "";
  const { error } = await service.from("agent_action_jobs").insert({
    id, agency_id: agencyId, client_id: v.clientId, ad_account_id: v.adAccountId,
    delegation_id: null, execution_origin: "manual", requested_by: ctx.user.id,
    // O mesmo envio duplicado (duplo clique) cai na mesma chave e nao cria segunda alteracao.
    idempotency_key: createHash("sha256").update(JSON.stringify([agencyId, ctx.user.id, v.requestId])).digest("hex"),
    action_type: v.action, meta_entity_id: v.targetId, daily_budget_minor: v.dailyBudgetMinor ?? null,
    new_name: v.newName !== undefined ? validateEntityName(v.newName).ok ? v.newName.trim() : null : null,
    facts_collected_at: new Date().toISOString(),
    rationale: `Alteracao manual solicitada por usuario autenticado${note}`.slice(0, 2000),
  });
  if (error) return fail(error.code === "23505" ? "Esta solicitacao ja foi registrada." : "Nao foi possivel registrar a alteracao.", error.code === "23505" ? "duplicate" : "insert_failed");

  const move = async (from: string, to: string, patch: Record<string, unknown> = {}) => {
    const { data, error: e } = await service.from("agent_action_jobs").update({ ...patch, status: to })
      .eq("agency_id", agencyId).eq("id", id).eq("status", from).select("id").maybeSingle();
    return !e && !!data;
  };
  if (!(await move("proposed", "authorized"))) {
    await move("proposed", "rejected", { failure_code: "authorization_failed" });
    return fail("Nao foi possivel autorizar a alteracao.");
  }
  // Conflito com outra mutacao nao resolvida na mesma conta (indice unico) => nao fica nada pendente.
  if (!(await move("authorized", "queued"))) {
    await move("authorized", "rejected", { failure_code: "account_busy" });
    return fail("Ja existe uma alteracao em andamento nesta conta. Aguarde a conclusao.", "account_busy");
  }
  // O clique e o ato explicito: executa agora, com as mesmas travas do worker (gate, runtime, politica).
  const outcome = await executeQueuedJobNow(service, { agencyId, jobId: id });
  // Executor desligado neste ambiente: nao deixar o pedido na fila para executar de surpresa no cron.
  if (outcome === "disabled" || outcome === "gate_closed") {
    await move("queued", "rejected", { failure_code: "executor_disabled" });
    return fail("A execucao de alteracoes nao esta habilitada neste ambiente. Nada foi alterado na Meta.", "executor_disabled");
  }
  return { ok: true, jobId: id, execution: outcome };
}

/** Envio do formulario manual: nenhum campo de organizacao, permissao ou token vem do navegador. */
export async function submitManualMetaChange(formData: FormData) {
  const budget = String(formData.get("dailyBudgetMinor") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "");
  const result = await requestManualMetaChange({
    requestId: String(formData.get("requestId") ?? ""), clientId,
    adAccountId: String(formData.get("adAccountId") ?? ""), action: String(formData.get("action") ?? ""),
    targetId: String(formData.get("targetId") ?? ""),
    ...(budget ? { dailyBudgetMinor: Number(budget) } : {}),
    ...(String(formData.get("note") ?? "").trim() ? { note: String(formData.get("note")) } : {}),
  });
  const { revalidatePath } = await import("next/cache");
  const { redirect } = await import("next/navigation");
  revalidatePath("/agente/aprovacoes");
  // So um codigo curto e fixo viaja na URL; a tela traduz para texto.
  const code = result.ok ? `ok_${result.execution}` : result.code;
  redirect(`/agente/manual?cliente=${encodeURIComponent(clientId)}&resultado=${encodeURIComponent(code.replace(/[^a-z_]/g, ""))}`);
}
