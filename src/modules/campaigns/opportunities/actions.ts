"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createAnthropicDecisionModel } from "@/modules/agent-executor/anthropic-decision-model";
import { analyzeOpportunities, loadOpportunityState, type Actor } from "./service";
import type { AnalyzeResult, OpportunityState } from "./contracts";

const input = z.object({ clientId: z.string() }).strict();

async function session() {
  const ctx = await requireAgencyContext();
  const service = createSupabaseServiceClient();
  if (!service) return null;
  const actor: Actor = { agencyId: ctx.agency.id, userId: ctx.user.id, role: ctx.role };
  return { actor, deps: { service, model: () => createAnthropicDecisionModel() } };
}

export async function loadOpportunitiesAction(raw: unknown): Promise<OpportunityState | null> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  const s = await session();
  return s ? loadOpportunityState(s.actor, parsed.data.clientId, s.deps).catch(() => null) : null;
}

export async function analyzeOpportunitiesAction(raw: unknown): Promise<AnalyzeResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "error", message: "Cliente inválido." };
  const s = await session();
  if (!s) return { ok: false, code: "error", message: "Serviço indisponível neste ambiente." };
  const result = await analyzeOpportunities(s.actor, parsed.data.clientId, s.deps);
  revalidatePath("/agente/aprovacoes");
  return result;
}
