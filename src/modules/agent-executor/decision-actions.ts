"use server";

import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAgencyContext } from "@/modules/agencies/context";
import { createAnthropicDecisionModel } from "./anthropic-decision-model";
import { runDecisionCycle } from "./decision-cycle";
import { decisionEngineEnabled } from "./decision-engine";

/**
 * "Analisar agora": roda o ciclo de decisao para UM cliente, por pedido de owner/admin autenticado.
 * A IA apenas PROPOE: cada proposta vira `awaiting_approval` e so executa com a aprovacao individual
 * de um responsavel. Mesmas travas do ciclo agendado (delegacao vigente, cota de IA, leitura ao vivo).
 */
export async function analyzeClientNow(formData: FormData) {
  const parsed = z.object({ clientId: z.uuid() }).safeParse({ clientId: String(formData.get("clientId") ?? "") });
  const { redirect } = await import("next/navigation");
  const done = (code: string, extra: Record<string, number> = {}): void => {
    const q = new URLSearchParams({ analise: code, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
    redirect(`/agente/aprovacoes?${q.toString()}`);
  };
  if (!parsed.success) return done("invalid");
  const ctx = await requireAgencyContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") return done("forbidden");
  if (!decisionEngineEnabled()) return done("disabled");
  const service = createSupabaseServiceClient();
  if (!service) return done("unavailable");
  const { data: client } = await service.from("clients").select("id").eq("agency_id", ctx.agency.id)
    .eq("id", parsed.data.clientId).is("archived_at", null).maybeSingle();
  if (!client) return done("invalid");

  let result: Awaited<ReturnType<typeof runDecisionCycle>>;
  try {
    result = await runDecisionCycle(service, { agencyId: ctx.agency.id, clientId: client.id }, { model: createAnthropicDecisionModel() });
  } catch { return done("error"); }
  if (!result.ok) return done(result.reason);

  let proposals = 0, blocked = 0, skipped = 0, observations = 0, rejected = 0;
  let skipReason = "";
  for (const account of result.accounts) {
    if (account.status === "skipped") { skipped += 1; skipReason ||= account.reason; continue; }
    observations += account.observations;
    rejected += account.rejected;
    for (const stage of account.stages) { if (stage.status === "awaiting_approval") proposals += 1; else blocked += 1; }
  }
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/agente/aprovacoes");
  const q = new URLSearchParams({ analise: "ok", p: String(proposals), b: String(blocked), s: String(skipped), o: String(observations), r: String(rejected) });
  if (skipReason) q.set("motivo", skipReason.replace(/[^a-z_]/g, ""));
  return redirect(`/agente/aprovacoes?${q.toString()}`);
}
