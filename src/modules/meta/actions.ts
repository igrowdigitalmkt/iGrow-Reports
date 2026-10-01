"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { getCompletePortalPeriod } from "@/modules/client-portal/metrics";
import { MetaApiError } from "./client";
import { validateCollectionRange } from "./collection";
import { collectMetaClientInsights, connectMetaForClient, MetaSetupError, syncMetaAccountsForClient } from "./server";

const accountLinkSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  adAccountId: z.uuid(),
  active: z.boolean(),
});

const mappingSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  primaryMetricKey: z.enum(["leads", "conversations", "purchases"]),
  primaryActionType: z.string().trim().min(1).max(240),
  revenueActionType: z.string().trim().max(240).optional().nullable(),
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
    return { error: "A agência selecionada mudou. Recarregue a página." };
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

  revalidatePath("/dashboard/clientes");
  revalidatePath(`/cliente/${parsed.data.clientId}`);
  return { success: true };
}

export async function setClientMetricMapping(
  input: unknown,
): Promise<MetaAdminActionResult> {
  const context = await requireAgencyContext();
  if (!canConfigureMeta(context.role)) {
    return { error: "Seu perfil não pode configurar o resultado principal." };
  }
  const parsed = mappingSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Configure o resultado principal e a ação Meta correspondente." };
  }
  if (parsed.data.agencyId !== context.agency.id) {
    return { error: "A agência selecionada mudou. Recarregue a página." };
  }

  const { error } = await context.supabase.rpc("set_client_metric_mapping", {
    p_agency_id: context.agency.id,
    p_client_id: parsed.data.clientId,
    p_primary_metric_key: parsed.data.primaryMetricKey,
    p_primary_action_type: parsed.data.primaryActionType,
    p_revenue_action_type: parsed.data.revenueActionType?.trim() || null,
  });

  if (error) {
    return { error: "Não foi possível salvar o mapeamento de métricas." };
  }

  revalidatePath("/dashboard/clientes");
  revalidatePath(`/cliente/${parsed.data.clientId}`);
  return { success: true };
}

const connectionSchema = z.object({
  agencyId: z.uuid(),
  clientId: z.uuid(),
  accessToken: z.string().trim().min(20).max(8192),
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
  if (error instanceof MetaSetupError) return error.message;
  if (error instanceof MetaApiError) {
    return error.code === 190
      ? "A credencial Meta foi rejeitada ou expirou."
      : "A Meta rejeitou a operação. Confira o acesso da credencial e tente novamente.";
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
    return { error: "Credencial ou agência inválida." };
  }

  try {
    const result = await connectMetaForClient({
      agencyId: context.agency.id,
      clientId: parsed.data.clientId,
      actorId: context.user.id,
      accessToken: parsed.data.accessToken,
    });
    revalidatePath("/dashboard/integracoes");
    revalidatePath("/dashboard/clientes");
    return { success: true, accountCount: result.accountCount };
  } catch (error) {
    return { error: safeMetaOperationError(error) };
  }
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
    return { error: "Agência inválida." };
  }

  try {
    const result = await syncMetaAccountsForClient({
      agencyId: context.agency.id,
      clientId: parsed.data.clientId,
      actorId: context.user.id,
    });
    revalidatePath("/dashboard/integracoes");
    revalidatePath("/dashboard/clientes");
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
    revalidatePath("/dashboard/clientes");
    revalidatePath(`/dashboard/clientes/${parsed.data.clientId}`);
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
