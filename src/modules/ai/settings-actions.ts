"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { DEFAULT_MONTHLY_BUDGET_USD } from "./defaults";
import { parseAiEntitlement } from "./entitlement";
import { aiAvailability, summarizeAiUsage } from "./usage-summary";

const agencyScope = z.object({ agencyId: z.uuid() });
const clientScope = z.object({ agencyId: z.uuid(), clientId: z.uuid() });
const isAdmin = (role: string) => role === "owner" || role === "admin";

export type AiSettingsView = {
  enabled: boolean; monthlyBudgetUsd: number;
  /** Total que conta contra o orçamento (liquidado + reservado + desconhecido): é o que o banco usa para recusar novas chamadas. */
  monthCostUsd: number;
  /** Consumo já liquidado (chamadas concluídas com custo conhecido). */
  settledUsd: number;
  /** Reservas em andamento: estimativas conservadoras, NÃO são gasto definitivo e serão trocadas pelo custo real. */
  reservedUsd: number;
  /** Consumo desconhecido (sem informação do provedor): mantido pela estimativa até a conciliação. */
  unknownUsd: number;
  /** Chamadas aguardando conciliação. */
  reconcileCount: number;
  /** Orçamento efetivo: o menor entre o configurado e o do plano. */
  effectiveBudgetUsd: number;
  /** Quanto ainda pode ser reservado neste mês. */
  availableUsd: number;
  generated: number; blocked: number; rejected: number;
};
export type AiSettingsResult = { error: string } | { settings: AiSettingsView };

async function loadView(context: Awaited<ReturnType<typeof requireAgencyContext>>): Promise<AiSettingsResult> {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const [settings, cost, usage, entitlement] = await Promise.all([
    context.supabase.from("ai_settings").select("enabled,monthly_budget_usd").eq("agency_id", context.agency.id).maybeSingle(),
    context.supabase.rpc("ai_month_cost", { p_agency_id: context.agency.id }),
    context.supabase.from("ai_usage").select("status,cost_usd,needs_reconciliation").eq("agency_id", context.agency.id).gte("created_at", monthStart).limit(5000),
    context.supabase.rpc("agency_ai_entitlement", { p_agency_id: context.agency.id }),
  ]);
  if (settings.error || cost.error || usage.error) return { error: "Não foi possível carregar as configurações de IA." };
  const rows = usage.data ?? [];
  const monthlyBudgetUsd = Number(settings.data?.monthly_budget_usd ?? DEFAULT_MONTHLY_BUDGET_USD);
  const planBudget = parseAiEntitlement(entitlement.error ? null : entitlement.data)?.budgetUsd ?? null;
  const monthCostUsd = Number(cost.data ?? 0);
  return { settings: {
    enabled: settings.data?.enabled ?? true,
    monthlyBudgetUsd,
    monthCostUsd, ...summarizeAiUsage(rows), ...aiAvailability(monthlyBudgetUsd, planBudget, monthCostUsd),
    generated: rows.filter(row => row.status === "ok").length,
    blocked: rows.filter(row => row.status === "blocked_budget" || row.status === "blocked_disabled").length,
    rejected: rows.filter(row => row.status === "rejected_numbers").length,
  } };
}

export async function getAiSettings(input: unknown): Promise<AiSettingsResult> {
  const context = await requireAgencyContext();
  const parsed = agencyScope.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  if (!isAdmin(context.role)) return { error: "Apenas proprietários e administradores configuram a IA." };
  return loadView(context);
}

export async function saveAiSettings(input: unknown): Promise<AiSettingsResult> {
  const context = await requireAgencyContext();
  const parsed = agencyScope.extend({ enabled: z.boolean(), monthlyBudgetUsd: z.number().min(0).max(1000) }).safeParse(input);
  if (!parsed.success) return { error: "Informe um limite mensal entre 0 e 2.000.000 de créditos." };
  if (parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  if (!isAdmin(context.role)) return { error: "Apenas proprietários e administradores configuram a IA." };
  const { error } = await context.supabase.from("ai_settings").upsert({
    agency_id: context.agency.id, enabled: parsed.data.enabled,
    monthly_budget_usd: Math.round(parsed.data.monthlyBudgetUsd * 100) / 100,
    updated_by: context.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "agency_id" });
  if (error) return { error: "Não foi possível salvar. Confira seu acesso e tente novamente." };
  revalidatePath("/configuracoes");
  return loadView(context);
}

export type ClientAiResult = { error: string } | { enabled: boolean };

export async function getClientAiEnabled(input: unknown): Promise<ClientAiResult> {
  const context = await requireAgencyContext();
  const parsed = clientScope.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const { data, error } = await context.supabase.from("ai_client_settings").select("enabled").eq("client_id", parsed.data.clientId).maybeSingle();
  if (error) return { error: "Não foi possível carregar a configuração de IA deste cliente." };
  return { enabled: data?.enabled ?? true };
}

export async function setClientAiEnabled(input: unknown): Promise<ClientAiResult> {
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Seu perfil permite apenas consultar clientes." };
  const parsed = clientScope.extend({ enabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: "Solicitação inválida. Atualize a página." };
  if (parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  const { error } = await context.supabase.from("ai_client_settings").upsert({
    client_id: parsed.data.clientId, agency_id: context.agency.id, enabled: parsed.data.enabled,
    updated_by: context.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });
  if (error) return { error: "Não foi possível salvar. Confira seu acesso e tente novamente." };
  return { enabled: parsed.data.enabled };
}
