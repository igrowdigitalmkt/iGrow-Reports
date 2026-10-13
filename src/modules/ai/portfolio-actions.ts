"use server";

import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { getMetaAdminSnapshot } from "@/modules/meta/admin";
import { loadPortfolioRows, PORTFOLIO_PERIODS, portfolioPeriod } from "@/modules/operations/portfolio-data";
import type { ClientItem } from "@/modules/clients/schema";
import { runGuardedGeneration } from "./guarded-text";
import { buildPortfolioFacts, PORTFOLIO_SYSTEM_PROMPT } from "./portfolio-facts";

const inputSchema = z.object({ agencyId: z.uuid(), period: z.enum(["7d", "30d", "90d"]) });
export type PortfolioSummaryResult = { ok: true; text: string } | { ok: false; message: string };

// "Resumo do dia": a IA só escreve a partir de alertas e números calculados no servidor. Nada é enviado a ninguém.
export async function generatePortfolioSummary(input: unknown): Promise<PortfolioSummaryResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Período inválido." };
  const context = await requireAgencyContext();
  if (parsed.data.agencyId !== context.agency.id) return { ok: false, message: "O espaço de trabalho mudou. Atualize a página." };
  if (context.role === "viewer") return { ok: false, message: "Seu perfil permite apenas consultar." };

  const clients: ClientItem[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await context.supabase.from("clients").select("id,name,notes,archived_at,updated_at")
      .eq("agency_id", context.agency.id).order("name").order("id").range(offset, offset + 499);
    if (result.error) return { ok: false, message: "Não foi possível consultar os clientes." };
    clients.push(...result.data);
    if (result.data.length < 500) break;
  }
  const period = portfolioPeriod(parsed.data.period);
  const meta = await getMetaAdminSnapshot(context.supabase, context.agency.id);
  const rows = await loadPortfolioRows(context.supabase, clients, meta, period);
  if (rows.length === 0) return { ok: false, message: "Ainda não há clientes ativos para resumir." };

  const periodLabel = PORTFOLIO_PERIODS.find(item => item.key === period)?.label ?? "Últimos 30 dias";
  const result = await runGuardedGeneration({
    agencyId: context.agency.id, clientId: null, userId: context.user.id, feature: "portfolio_summary",
    system: PORTFOLIO_SYSTEM_PROMPT, factsLabel: "Fatos confirmados da carteira (JSON):",
    factsText: JSON.stringify(buildPortfolioFacts(rows, periodLabel), null, 2), sourceRef: `carteira:${period}`, maxTokens: 1200,
  });
  return result.ok ? { ok: true, text: result.text } : { ok: false, message: result.message };
}
