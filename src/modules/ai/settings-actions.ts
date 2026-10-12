"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { DEFAULT_MONTHLY_BUDGET_USD } from "./defaults";

const agencyScope = z.object({ agencyId: z.uuid() });
const clientScope = z.object({ agencyId: z.uuid(), clientId: z.uuid() });
const isAdmin = (role: string) => role === "owner" || role === "admin";

export type AiSettingsView = {
  enabled: boolean; monthlyBudgetUsd: number; monthCostUsd: number;
  generated: number; blocked: number; rejected: number;
};
export type AiSettingsResult = { error: string } | { settings: AiSettingsView };

async function loadView(context: Awaited<ReturnType<typeof requireAgencyContext>>): Promise<AiSettingsResult> {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const [settings, cost, usage] = await Promise.all([
    context.supabase.from("ai_settings").select("enabled,monthly_budget_usd").eq("agency_id", context.agency.id).maybeSingle(),
    context.supabase.rpc("ai_month_cost", { p_agency_id: context.agency.id }),
    context.supabase.from("ai_usage").select("status").eq("agency_id", context.agency.id).gte("created_at", monthStart).limit(5000),
  ]);
  if (settings.error || cost.error || usage.error) return { error: "Não foi possível carregar as configurações de IA." };
  const rows = usage.data ?? [];
  return { settings: {
    enabled: settings.data?.enabled ?? true,
    monthlyBudgetUsd: Number(settings.data?.monthly_budget_usd ?? DEFAULT_MONTHLY_BUDGET_USD),
    monthCostUsd: Number(cost.data ?? 0),
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
  if (!parsed.success) return { error: "Informe um orçamento mensal entre US$ 0 e US$ 1.000." };
  if (parsed.data.agencyId !== context.agency.id) return { error: "O espaço de trabalho mudou. Atualize a página." };
  if (!isAdmin(context.role)) return { error: "Apenas proprietários e administradores configuram a IA." };
  const { error } = await context.supabase.from("ai_settings").upsert({
    agency_id: context.agency.id, enabled: parsed.data.enabled,
    monthly_budget_usd: Math.round(parsed.data.monthlyBudgetUsd * 100) / 100,
    updated_by: context.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "agency_id" });
  if (error) return { error: "Não foi possível salvar. Confira seu acesso e tente novamente." };
  revalidatePath("/dashboard/configuracoes");
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
