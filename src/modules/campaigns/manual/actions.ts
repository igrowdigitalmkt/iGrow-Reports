"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { loadManualHistory, resolveManualControl, runManualOperation, type Actor } from "./control";
import type { ManualControl, ManualHistoryItem, ManualRunResult } from "./contracts";

const ref = z.object({ clientId: z.string(), accountId: z.string(), level: z.enum(["campaign", "adset", "ad"]), entityId: z.string() }).strict();
const runSchema = z.object({
  ref, op: z.enum(["pause", "resume", "budget", "rename"]), requestId: z.string(),
  expected: z.object({ configuredStatus: z.enum(["ACTIVE", "PAUSED"]), dailyBudgetMinor: z.number().int().nonnegative().nullable(), name: z.string().max(1000).nullable().optional() }).strict(),
  dailyBudgetMinor: z.number().int().positive().optional(),
  newName: z.string().max(400).optional(),
}).strict();

async function session() {
  const ctx = await requireAgencyContext();
  const service = createSupabaseServiceClient();
  if (!service) return null;
  const actor: Actor = { agencyId: ctx.agency.id, userId: ctx.user.id, role: ctx.role };
  return { actor, deps: { service } };
}

/** Estado atual (lido AGORA na Meta) e o que o usuário pode fazer. A decisão de permissão é do servidor. */
export async function loadManualControlAction(input: unknown): Promise<{ control: ManualControl; history: ManualHistoryItem[] | null }> {
  const parsed = ref.safeParse(input);
  const unknown: ManualControl = { kind: "unknown_state", message: "Não foi possível consultar o estado atual agora." };
  if (!parsed.success) return { control: { kind: "incompatible", message: "Entidade inválida." }, history: null };
  const s = await session();
  if (!s) return { control: unknown, history: null };
  const control = await resolveManualControl(s.actor, parsed.data, s.deps).catch(() => unknown);
  const history = control.kind === "unauthorized" ? null : await loadManualHistory(s.actor, parsed.data, s.deps).catch(() => null);
  return { control, history };
}

/** Prontidão das operações novas (renomear e anúncios): o banco as aceita? Sem segredos; qualquer erro vale como "ainda não". */
export async function loadManualCapabilitiesAction(): Promise<{ extended: boolean }> {
  const s = await session();
  if (!s || (s.actor.role !== "owner" && s.actor.role !== "admin")) return { extended: false };
  const { data, error } = await s.deps.service.rpc("agent_manual_extended_actions_supported").then(result => result, () => ({ data: null, error: true }));
  return { extended: !error && data === true };
}

export async function runManualOperationAction(input: unknown): Promise<ManualRunResult & { history?: ManualHistoryItem[] | null }> {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: "Dados da operação inválidos." };
  const s = await session();
  if (!s) return { ok: false, code: "unavailable", message: "Serviço indisponível neste ambiente." };
  const result = await runManualOperation(s.actor, parsed.data, s.deps).catch((): ManualRunResult => ({ ok: false, code: "failed", message: "Não foi possível concluir a operação. Consulte o histórico antes de tentar novamente." }));
  const history = await loadManualHistory(s.actor, parsed.data.ref, s.deps).catch(() => null);
  // A tela só atualiza os dados depois de uma confirmação efetiva da Meta.
  if (result.ok && result.outcome === "verified") revalidatePath("/clientes/[clientId]/campanhas", "layout");
  return { ...result, history };
}
