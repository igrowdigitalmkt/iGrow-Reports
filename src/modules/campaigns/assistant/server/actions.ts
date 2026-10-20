"use server";

import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AGENCY_COOKIE, getUserMemberships } from "@/modules/agencies/context";
import { loadOwnModules } from "@/modules/team/admin";
import { canOpenSection } from "@/modules/team/permissions";
import { loadCampaignsData } from "../../load";
import type { AssistantAvailability } from "../contracts";
import type { AssistantAskResult } from "../request";
import { createAnthropicChatModel } from "./anthropic-model";
import { FACT_LIMITS } from "./facts";
import { campaignChatEnabledByOperator, estimateCallCostUsd, evaluateChatGate, readGateConfig, unreadGateConfig, type GateConfig } from "./gate";
import { handleAssistantRequest, SYSTEM_PROMPT, type AssistantDeps, type AssistantSession, type SessionResult } from "./handler";
import { acquireChatSlot, accountingHealthy, campaignChatSupportedByDatabase, claimRequestId, markAccountingFailure, reservationsReadyInDatabase, reserveCampaignChat, settleCampaignChat } from "./usage";

// Sessão SEM redirecionamento (uma ação do navegador deve receber um erro, não uma página): usuário autenticado, memberships relidas
// sob o RLS dele e organização escolhida entre elas. O cookie só escolhe entre organizações das quais o usuário é membro.
async function getSession(): Promise<SessionResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, code: "unauthenticated" };
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, code: "unauthenticated" };
  const memberships = await getUserMemberships(supabase, user.id);
  const selectedId = (await cookies()).get(AGENCY_COOKIE)?.value;
  const selected = memberships.find(({ agency }) => agency.id === selectedId) ?? (memberships.length === 1 ? memberships[0] : undefined);
  if (!selected) return { ok: false, code: "no_workspace" };
  return { ok: true, session: { agency: selected.agency, role: selected.role, userId: user.id } };
}

const model = createAnthropicChatModel();

async function canOpenCampaigns(session: AssistantSession) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;
  const modules = session.role === "owner" || session.role === "admin" ? null : await loadOwnModules(supabase, session.agency.id, session.userId);
  return canOpenSection(session.role, modules, "campanhas");
}

async function findClient(session: AssistantSession, clientId: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.from("clients").select("id,name").eq("id", clientId).eq("agency_id", session.agency.id).is("archived_at", null).maybeSingle();
  return data ?? null;
}

/**
 * Estado de liberação lido no servidor, a cada solicitação. Só consulta o banco quando tudo que não depende dele já está de pé
 * (chave de operação, contabilização e modelo); a categoria campaign_chat é CONFIRMADA no banco do ambiente, nunca presumida.
 */
async function readGate(session: AssistantSession, clientId: string, estimatedCallCostUsd: number): Promise<GateConfig> {
  const enabledByOperator = campaignChatEnabledByOperator();
  const base = { enabledByOperator, featureRegistered: false, reservationsReady: false, accountingHealthy: accountingHealthy(), modelConfigured: model.configured, estimatedCallCostUsd };
  if (!enabledByOperator) return unreadGateConfig(base);
  const service = createSupabaseServiceClient();
  const featureRegistered = await campaignChatSupportedByDatabase(service);
  const reservationsReady = await reservationsReadyInDatabase(service);
  const runtime = { ...base, featureRegistered, reservationsReady };
  if (!service || !featureRegistered || !reservationsReady || !runtime.accountingHealthy || !runtime.modelConfigured) return unreadGateConfig(runtime);
  return readGateConfig(service, session.agency.id, clientId, runtime);
}

const deps: AssistantDeps = {
  getSession, canOpenCampaigns, findClient, loadData: loadCampaignsData, readGate, model,
  // Reserva e liquidação atômicas no banco (cliente de serviço só aqui, depois de sessão, organização, cliente e contexto autorizados).
  async reserveUsage(input) {
    const service = createSupabaseServiceClient();
    return service ? reserveCampaignChat(service, input) : { ok: false, outcome: "unavailable" };
  },
  async settleUsage(settlement) {
    const service = createSupabaseServiceClient();
    if (!service) { markAccountingFailure(); return false; }
    return settleCampaignChat(service, settlement);
  },
  acquireSlot: key => acquireChatSlot(key),
  claimRequest: key => claimRequestId(key),
  now: () => Date.now(),
};

/**
 * Pergunta ao Assistente Groow (somente consulta). O navegador envia identificadores; tudo é revalidado aqui.
 * Sem a chave CAMPAIGN_CHAT_ENABLED=1, sem a categoria no banco ou sem contabilização saudável, nenhuma chamada paga acontece.
 */
export async function askAssistant(input: unknown): Promise<AssistantAskResult> {
  try { return await handleAssistantRequest(input, deps); }
  catch (error) {
    console.error("assistant-ask", { name: error instanceof Error ? error.name : typeof error });
    return { ok: false, code: "model_error", message: "Não foi possível consultar o assistente agora." };
  }
}

/**
 * Disponibilidade para a tela (apenas informativa: toda solicitação é revalidada). O envio só é habilitado quando o servidor confirma
 * sessão, permissão, cliente, chave de operação, categoria no banco, contabilização, modelo, plano, interruptores e cota.
 */
export async function fetchAssistantAvailability(clientId: string): Promise<AssistantAvailability> {
  const unavailable = (reason: Extract<AssistantAvailability, { state: "unavailable" }>["reason"], message: string): AssistantAvailability => ({ state: "unavailable", reason, message });
  try {
    const session = await getSession();
    if (!session.ok) return unavailable("no_permission", "Entre para usar o assistente.");
    if (!(await canOpenCampaigns(session.session))) return unavailable("no_permission", "Seu acesso não inclui o assistente.");
    if (!(await findClient(session.session, clientId))) return unavailable("no_permission", "Cliente indisponível.");
    const decision = evaluateChatGate(await readGate(session.session, clientId, estimateCallCostUsd(SYSTEM_PROMPT.length + FACT_LIMITS.maxChars)));
    return decision.allowed ? { state: "available" } : unavailable(decision.reason, decision.message);
  } catch {
    return unavailable("unverifiable", "Não foi possível verificar a disponibilidade do assistente.");
  }
}
