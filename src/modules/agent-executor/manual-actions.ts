"use server";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { ACTIONS } from "./policy";

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
  action: z.enum(ACTIONS),
  targetId: z.string().regex(/^[1-9]\d*$/),
  dailyBudgetMinor: z.number().int().positive().max(1_000_000_000_000).optional(),
  note: z.string().trim().max(300).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.action.startsWith("set_") !== (v.dailyBudgetMinor !== undefined))
    ctx.addIssue({ code: "custom", path: ["dailyBudgetMinor"], message: "Orcamento incompativel com a acao." });
});

export type ManualChangeResult = { ok: true; jobId: string } | { ok: false; message: string };
const fail = (message: string): ManualChangeResult => ({ ok: false, message });

export async function requestManualMetaChange(input: unknown): Promise<ManualChangeResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Dados da alteracao invalidos.");
  const ctx = await requireAgencyContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") return fail("Somente proprietario ou administrador pode alterar campanhas.");
  const service = createSupabaseServiceClient();
  if (!service) return fail("Servico indisponivel neste ambiente.");
  const v = parsed.data, agencyId = ctx.agency.id;

  const { data: enabled } = await service.rpc("agent_meta_execution_allowed", { p_agency_id: agencyId });
  if (enabled !== true) return fail("A execucao de alteracoes ainda nao esta habilitada para esta organizacao.");
  const [{ data: client }, { data: link }, { data: account }] = await Promise.all([
    service.from("clients").select("id").eq("agency_id", agencyId).eq("id", v.clientId).is("archived_at", null).maybeSingle(),
    service.from("client_ad_accounts").select("active").eq("agency_id", agencyId)
      .eq("client_id", v.clientId).eq("ad_account_id", v.adAccountId).maybeSingle(),
    service.from("meta_ad_accounts").select("id").eq("agency_id", agencyId).eq("id", v.adAccountId).is("archived_at", null).maybeSingle(),
  ]);
  if (!client || !link?.active || !account) return fail("Cliente ou conta de anuncios indisponivel.");

  const id = randomUUID();
  const note = v.note ? `: ${v.note}` : "";
  const { error } = await service.from("agent_action_jobs").insert({
    id, agency_id: agencyId, client_id: v.clientId, ad_account_id: v.adAccountId,
    delegation_id: null, execution_origin: "manual", requested_by: ctx.user.id,
    // O mesmo envio duplicado (duplo clique) cai na mesma chave e nao cria segunda alteracao.
    idempotency_key: createHash("sha256").update(JSON.stringify([agencyId, ctx.user.id, v.requestId])).digest("hex"),
    action_type: v.action, meta_entity_id: v.targetId, daily_budget_minor: v.dailyBudgetMinor ?? null,
    facts_collected_at: new Date().toISOString(),
    rationale: `Alteracao manual solicitada por usuario autenticado${note}`.slice(0, 2000),
  });
  if (error) return fail(error.code === "23505" ? "Esta solicitacao ja foi registrada." : "Nao foi possivel registrar a alteracao.");

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
    return fail("Ja existe uma alteracao em andamento nesta conta. Aguarde a conclusao.");
  }
  return { ok: true, jobId: id };
}

/** Envio do formulario manual: nenhum campo de organizacao, permissao ou token vem do navegador. */
export async function submitManualMetaChange(formData: FormData) {
  const budget = String(formData.get("dailyBudgetMinor") ?? "").trim();
  const result = await requestManualMetaChange({
    requestId: String(formData.get("requestId") ?? ""), clientId: String(formData.get("clientId") ?? ""),
    adAccountId: String(formData.get("adAccountId") ?? ""), action: String(formData.get("action") ?? ""),
    targetId: String(formData.get("targetId") ?? ""),
    ...(budget ? { dailyBudgetMinor: Number(budget) } : {}),
    ...(String(formData.get("note") ?? "").trim() ? { note: String(formData.get("note")) } : {}),
  });
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/agente/aprovacoes");
  if (!result.ok) throw new Error(result.message);
}
