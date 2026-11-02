"use server";

import { BillingRestrictedError } from "@/modules/billing/guard";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { getCompletePortalPeriod } from "@/modules/client-portal/metrics";
import { MetaApiError, MetaClient, hasBusinessPortfolio } from "./client";
import { getMetaApiConfig } from "@/lib/env";
import { META_LOGIN_APP_ID } from "./login-config";
import { validateCollectionRange } from "./collection";
import { collectMetaClientInsights, connectMetaAgencyLogin, connectMetaForClient, disconnectMetaAgencyLogin, disconnectMetaForClient, linkClientToAgencyLogin, listAgencyLoginAccounts, MetaSetupError, syncMetaAccountsForClient, type AgencyLoginAccount } from "./server";

const accountLinkSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  adAccountId: z.uuid(),
  active: z.boolean(),
});

export type MetaAdminActionResult =
  | { success: true }
  | { error: string };

function canConfigureMeta(role: string) {
  return role === "owner" || role === "admin" || role === "editor";
}

export async function setClientAdAccount(
  input: unknown,
): Promise<MetaAdminActionResult> {
  const context = await requireAgencyContext();
  if (!canConfigureMeta(context.role)) {
    return { error: "Seu perfil não pode alterar contas de anúncios do cliente." };
  }
  const parsed = accountLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Associação inválida. Atualize a página e tente novamente." };
  }
  if (parsed.data.agencyId !== context.agency.id) {
    return { error: "O espaço de trabalho selecionado mudou. Recarregue a página." };
  }

  const { error } = await context.supabase.rpc("set_client_ad_account", {
    p_agency_id: context.agency.id,
    p_client_id: parsed.data.clientId,
    p_ad_account_id: parsed.data.adAccountId,
    p_active: parsed.data.active,
  });

  if (error) {
    return {
      error: parsed.data.active
        ? "Não foi possível associar esta conta de anúncios ao cliente."
        : "Não foi possível remover esta associação.",
    };
  }

  revalidatePath("/clientes");
  revalidatePath(`/cliente/${parsed.data.clientId}`);
  revalidatePath(`/clientes/${parsed.data.clientId}`);
  return { success: true };
}

const connectionSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  accessToken: z.string().trim().min(20).max(8192),
  selectedAccountIds: z.array(z.string().regex(/^act_\d+$/)).min(1).max(500).optional(),
});

const clientOperationSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
});

const collectionSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  period: z.enum(["7d", "30d"]).default("30d"),
  since: z.string().optional(),
  until: z.string().optional(),
  forceRefresh: z.boolean().default(false),
}).refine((value) => Boolean(value.since) === Boolean(value.until));

function safeMetaOperationError(error: unknown) {
  if (error instanceof MetaSetupError || error instanceof BillingRestrictedError) return error.message;
  if (error instanceof MetaApiError) {
    return error.code === 190
      ? "A credencial Meta foi rejeitada ou expirou."
      : `A Meta recusou ${error.operation ?? "a consulta"}${error.code !== null ? ` (código ${error.code}${error.subcode !== null ? `/${error.subcode}` : ""})` : ""}. ${error.reason ?? "Confira se esta conta do Facebook tem acesso aos anúncios e se concedeu a permissão de leitura."}`;
  }
  return "Não foi possível concluir a operação com a Meta.";
}

export async function connectMetaIntegration(
  input: unknown,
): Promise<MetaAdminActionResult & { accountCount?: number }> {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") {
    return { error: "Somente proprietário ou administrador pode gerenciar a credencial Meta." };
  }
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) {
    return { error: "Credencial ou espaço de trabalho inválido." };
  }
  const { data: targetClient } = await context.supabase.from("clients").select("id")
    .eq("agency_id", context.agency.id).eq("id", parsed.data.clientId).is("archived_at", null).maybeSingle();
  if (!targetClient) return { error: "Cliente indisponível neste espaço de trabalho." };

  try {
    let accessToken = parsed.data.accessToken;
    if (parsed.data.selectedAccountIds) {
      const secret = process.env.META_APP_SECRET?.trim();
      const api = getMetaApiConfig();
      if (!secret || !api) return { error: "O login oficial está aguardando configuração do servidor." };
      const exchange = await fetch(`https://graph.facebook.com/${api.apiVersion}/oauth/access_token`, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "fb_exchange_token", client_id: META_LOGIN_APP_ID, client_secret: secret, fb_exchange_token: accessToken }),
      });
      const exchanged = await exchange.json() as { access_token?: string };
      if (!exchange.ok || !exchanged.access_token) return { error: "A Meta não confirmou a autorização. Conecte novamente." };
      accessToken = exchanged.access_token;
    }
    const result = await connectMetaForClient({
      agencyId: context.agency.id,
      clientId: parsed.data.clientId,
      actorId: context.user.id,
      accessToken,
      selectedAccountIds: parsed.data.selectedAccountIds,
    });
    revalidatePath("/integracoes");
    revalidatePath("/clientes");
    return { success: true, accountCount: result.accountCount };
  } catch (error) {
    return { error: safeMetaOperationError(error) };
  }
}

export async function disconnectMetaClientAction(input: unknown): Promise<MetaAdminActionResult> {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return { error: "Somente proprietário ou administrador pode desconectar a Meta." };
  const parsed = z.object({ clientId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Cliente inválido." };
  const { data: client } = await context.supabase.from("clients").select("id").eq("agency_id", context.agency.id).eq("id", parsed.data.clientId).maybeSingle();
  if (!client) return { error: "Cliente indisponível neste espaço de trabalho." };
  try {
    await disconnectMetaForClient({ agencyId: context.agency.id, clientId: parsed.data.clientId });
    revalidatePath("/integracoes");
    revalidatePath("/clientes");
    return { success: true };
  } catch (error) {
    return { error: safeMetaOperationError(error) };
  }
}

async function exchangeForLongLivedToken(shortLived: string): Promise<string | null> {
  const secret = process.env.META_APP_SECRET?.trim();
  const api = getMetaApiConfig();
  if (!secret || !api) return null;
  const exchange = await fetch(`https://graph.facebook.com/${api.apiVersion}/oauth/access_token`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "fb_exchange_token", client_id: META_LOGIN_APP_ID, client_secret: secret, fb_exchange_token: shortLived }),
  });
  const exchanged = await exchange.json().catch(() => null) as { access_token?: string } | null;
  return exchange.ok && exchanged?.access_token ? exchanged.access_token : null;
}

/** Conecta uma conta empresarial (login do Facebook) da agência: vale para todos os clientes, que só escolhem os ativos deles. */
export async function connectMetaAgencyLoginAction(input: unknown): Promise<MetaAdminActionResult & { name?: string | null; accountCount?: number; portfolioCount?: number }> {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return { error: "Somente proprietário ou administrador pode conectar contas empresariais." };
  const parsed = z.object({ agencyId: z.uuid(), accessToken: z.string().trim().min(20).max(8192) }).safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) return { error: "Credencial ou espaço de trabalho inválido." };
  try {
    const longLived = await exchangeForLongLivedToken(parsed.data.accessToken);
    if (!longLived) return { error: "A Meta não confirmou a autorização. Conecte novamente." };
    const result = await connectMetaAgencyLogin({ agencyId: context.agency.id, actorId: context.user.id, accessToken: longLived });
    revalidatePath("/integracoes");
    return { success: true, name: result.name, accountCount: result.accountCount, portfolioCount: result.portfolioCount };
  } catch (error) { return { error: safeMetaOperationError(error) }; }
}

export async function listAgencyLoginAccountsAction(input: unknown): Promise<{ error: string } | { accounts: AgencyLoginAccount[] }> {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return { error: "Somente proprietário ou administrador pode escolher contas." };
  const parsed = z.object({ clientId: z.uuid(), connectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Pedido inválido." };
  const { data: client } = await context.supabase.from("clients").select("id").eq("agency_id", context.agency.id).eq("id", parsed.data.clientId).is("archived_at", null).maybeSingle();
  if (!client) return { error: "Cliente indisponível neste espaço de trabalho." };
  try { return { accounts: await listAgencyLoginAccounts({ agencyId: context.agency.id, connectionId: parsed.data.connectionId, forClientId: parsed.data.clientId }) }; }
  catch (error) { return { error: safeMetaOperationError(error) }; }
}

export async function linkClientAccountsAction(input: unknown): Promise<MetaAdminActionResult & { accountCount?: number }> {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return { error: "Somente proprietário ou administrador pode escolher contas." };
  const parsed = z.object({ clientId: z.uuid(), connectionId: z.uuid(), selectedAccountIds: z.array(z.string().regex(/^act_\d+$/)).min(1).max(500) }).safeParse(input);
  if (!parsed.success) return { error: "Escolha ao menos uma conta de anúncios." };
  const { data: client } = await context.supabase.from("clients").select("id").eq("agency_id", context.agency.id).eq("id", parsed.data.clientId).is("archived_at", null).maybeSingle();
  if (!client) return { error: "Cliente indisponível neste espaço de trabalho." };
  try {
    const result = await linkClientToAgencyLogin({ agencyId: context.agency.id, clientId: parsed.data.clientId, actorId: context.user.id, connectionId: parsed.data.connectionId, selectedAccountIds: parsed.data.selectedAccountIds });
    revalidatePath("/integracoes"); revalidatePath("/clientes"); revalidatePath(`/cliente/${parsed.data.clientId}`);
    return { success: true, accountCount: result.accountCount };
  } catch (error) { return { error: safeMetaOperationError(error) }; }
}

export async function disconnectMetaAgencyLoginAction(input: unknown): Promise<MetaAdminActionResult & { releasedClients?: number }> {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") return { error: "Somente proprietário ou administrador pode desconectar contas empresariais." };
  const parsed = z.object({ connectionId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Pedido inválido." };
  try {
    const result = await disconnectMetaAgencyLogin({ agencyId: context.agency.id, connectionId: parsed.data.connectionId });
    revalidatePath("/integracoes"); revalidatePath("/clientes");
    return { success: true, releasedClients: result.releasedClients };
  } catch (error) { return { error: safeMetaOperationError(error) }; }
}

export async function previewMetaLoginAccounts(input: unknown) {
  const context = await requireAgencyContext();
  const parsed = connectionSchema.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id || !["owner", "admin"].includes(context.role)) return { error: "Você não pode conectar contas neste espaço de trabalho." };
  const { data: clientRow } = await context.supabase.from("clients").select("id").eq("agency_id", context.agency.id).eq("id", parsed.data.clientId).is("archived_at", null).maybeSingle();
  if (!clientRow) return { error: "Cliente indisponível." };
  const config = getMetaApiConfig();
  if (!config) return { error: "A conexão Meta ainda não está configurada." };
  try {
    const api = new MetaClient({ accessToken: parsed.data.accessToken, apiVersion: config.apiVersion });
    const identity = await api.validateConnection();
    // Facebook Login returns a person, not a Business Manager system user.
    const accounts = await api.listAdAccounts();
    return { accounts: accounts.map(account => ({ id: account.id, name: account.name, supported: hasBusinessPortfolio(account) })), name: identity.name ?? "Conta Facebook" };
  } catch (error) { return { error: safeMetaOperationError(error) }; }
}

export async function syncMetaAccounts(
  input: unknown,
): Promise<MetaAdminActionResult & { accountCount?: number }> {
  const context = await requireAgencyContext();
  if (context.role !== "owner" && context.role !== "admin") {
    return { error: "Somente proprietário ou administrador pode sincronizar contas Meta." };
  }
  const parsed = clientOperationSchema.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) {
    return { error: "Espaço de trabalho inválido." };
  }

  try {
    const result = await syncMetaAccountsForClient({
      agencyId: context.agency.id,
      clientId: parsed.data.clientId,
      actorId: context.user.id,
    });
    revalidatePath("/integracoes");
    revalidatePath("/clientes");
    return { success: true, accountCount: result.accountCount };
  } catch (error) {
    return { error: safeMetaOperationError(error) };
  }
}

export async function collectClientMetaData(
  input: unknown,
): Promise<MetaAdminActionResult & {
  insightCount?: number;
  completedSliceCount?: number;
  failedSliceCount?: number;
  dateFrom?: string;
  dateTo?: string;
}> {
  const context = await requireAgencyContext();
  if (!canConfigureMeta(context.role)) {
    return { error: "Seu perfil não pode atualizar dados Meta do cliente." };
  }
  const parsed = collectionSchema.safeParse(input);
  if (!parsed.success || parsed.data.agencyId !== context.agency.id) {
    return { error: "Cliente ou período inválido." };
  }

  const { data: dataContext, error: contextError } = await context.supabase
    .rpc("get_client_portal_data_context", {
      p_client_id: parsed.data.clientId,
    })
    .single();
  if (contextError || !dataContext) {
    return { error: "Não foi possível validar as contas Meta deste cliente." };
  }
  if (dataContext.ad_account_count < 1
    || (dataContext.data_status !== "ok" && dataContext.compatibility_issue !== "multiple_currencies")) {
    return {
      error: "Associe ao menos uma conta Meta válida antes de atualizar os dados.",
    };
  }

  const defaultPeriod = getCompletePortalPeriod(
    parsed.data.period,
    dataContext.timezone_name ?? context.agency.timezone,
  );
  const dateFrom = parsed.data.since ?? defaultPeriod.dateFrom;
  const dateTo = parsed.data.until ?? defaultPeriod.dateTo;
  try {
    validateCollectionRange(dateFrom, dateTo);
    if (dateTo > defaultPeriod.dateTo) {
      return { error: "Escolha dias completos, até ontem no fuso do painel." };
    }
  } catch {
    return { error: "Escolha datas válidas e um período de até 370 dias." };
  }

  try {
    const result = await collectMetaClientInsights({
      agencyId: context.agency.id,
      clientId: parsed.data.clientId,
      actorId: context.user.id,
      since: dateFrom,
      until: dateTo,
      forceRefresh: parsed.data.forceRefresh,
    });
    revalidatePath("/clientes");
    revalidatePath(`/clientes/${parsed.data.clientId}`);
    revalidatePath(`/cliente/${parsed.data.clientId}`);
    if (result.failures.length) {
      return {
        error: `${result.completedSliceCount} lotes concluídos; ${result.failures.length} falhas. Os dados salvos foram preservados. Atualize novamente para concluir a coleta.`,
        insightCount: result.insightCount,
        completedSliceCount: result.completedSliceCount,
        failedSliceCount: result.failures.length,
        dateFrom,
        dateTo,
      };
    }
    return {
      success: true,
      insightCount: result.insightCount,
      completedSliceCount: result.completedSliceCount,
      failedSliceCount: 0,
      dateFrom,
      dateTo,
    };
  } catch (error) {
    return { error: safeMetaOperationError(error) };
  }
}
