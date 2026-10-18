"use server";

import { BillingRestrictedError } from "@/modules/billing/guard";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAgencyContext } from "@/modules/agencies/context";
import { disconnectGoogle, googleAdsAppConfig, googleRedirectUri, googleServiceClient, GoogleAdsSetupError, syncGoogleAccounts } from "./server";
import { isCustomerId, normalizeCustomerId } from "./client";

export type GoogleAdsStatus = {
  configured: boolean; missing: string[]; redirectUri: string | null; canManage: boolean;
  connected: boolean; loginCustomerId: string | null; lastSyncAt: string | null;
  accounts: Array<{ id: string; customerId: string; name: string; currency: string; clientIds: string[] }>;
};

const isAdmin = (role: string) => role === "owner" || role === "admin";
const failure = (error: unknown) => ({ error: error instanceof GoogleAdsSetupError || error instanceof BillingRestrictedError ? error.message : "Não foi possível concluir. Tente novamente." });

export async function getGoogleAdsStatus(): Promise<GoogleAdsStatus> {
  const context = await requireAgencyContext();
  const config = googleAdsAppConfig();
  const base = { configured: config.ready, missing: config.missing, redirectUri: googleRedirectUri(), canManage: isAdmin(context.role) };
  const { data: connection } = await context.supabase.from("google_connections").select("id,login_customer_id,last_accounts_sync_at,connected_at").eq("agency_id", context.agency.id).maybeSingle();
  // Desconectado = sem data de conexão (o token foi apagado), mesmo que a linha da conexão ainda exista.
  if (!connection?.connected_at) return { ...base, connected: false, loginCustomerId: null, lastSyncAt: null, accounts: [] };
  const [{ data: accounts }, { data: links }] = await Promise.all([
    context.supabase.from("google_ad_accounts").select("id,customer_id,name,currency").eq("agency_id", context.agency.id).is("archived_at", null).order("name"),
    context.supabase.from("client_google_accounts").select("client_id,google_ad_account_id").eq("agency_id", context.agency.id).eq("active", true),
  ]);
  return { ...base, connected: true, loginCustomerId: connection.login_customer_id, lastSyncAt: connection.last_accounts_sync_at,
    accounts: (accounts ?? []).map(account => ({ id: account.id, customerId: account.customer_id, name: account.name, currency: account.currency,
      clientIds: (links ?? []).filter(link => link.google_ad_account_id === account.id).map(link => link.client_id) })) };
}

export async function saveGoogleLoginCustomer(input: unknown) {
  const parsed = z.object({ customerId: z.string().trim() }).safeParse(input);
  if (!parsed.success || !isCustomerId(parsed.data.customerId)) return { error: "Informe o número da conta de gerente com 10 dígitos (ex.: 123-456-7890)." };
  const context = await requireAgencyContext();
  if (!isAdmin(context.role)) return { error: "Apenas proprietários e administradores configuram o Google Ads." };
  try {
    const { error } = await googleServiceClient().from("google_connections").update({ login_customer_id: normalizeCustomerId(parsed.data.customerId) }).eq("agency_id", context.agency.id);
    if (error) return { error: "Conecte o Google Ads antes de informar o gerente." };
    revalidatePath("/integracoes");
    return { success: true as const };
  } catch (error) { return failure(error); }
}

export async function syncGoogleAdsAccountsAction() {
  const context = await requireAgencyContext();
  if (!isAdmin(context.role)) return { error: "Apenas proprietários e administradores configuram o Google Ads." };
  try {
    const result = await syncGoogleAccounts(googleServiceClient(), context.agency.id);
    revalidatePath("/integracoes");
    return { success: true as const, ...result };
  } catch (error) { return failure(error); }
}

export async function disconnectGoogleAdsAction() {
  const context = await requireAgencyContext();
  if (!isAdmin(context.role)) return { error: "Apenas proprietários e administradores configuram o Google Ads." };
  try {
    const result = await disconnectGoogle(googleServiceClient(), context.agency.id);
    revalidatePath("/integracoes");
    return { success: true as const, ...result };
  } catch (error) { return failure(error); }
}

export async function linkGoogleAccountAction(input: unknown) {
  const parsed = z.object({ accountId: z.uuid(), clientId: z.uuid(), linked: z.boolean() }).safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };
  const context = await requireAgencyContext();
  if (context.role === "viewer") return { error: "Leitores não podem vincular contas." };
  const { accountId, clientId, linked } = parsed.data;
  // Sem upsert: o acesso do usuário só permite inserir o vínculo ou alterar o campo "ativo" (o upsert tenta regravar as demais colunas).
  const { data: existing, error: lookup } = await context.supabase.from("client_google_accounts").select("active")
    .eq("agency_id", context.agency.id).eq("client_id", clientId).eq("google_ad_account_id", accountId).maybeSingle();
  const { error } = lookup ? { error: lookup }
    : existing
      ? await context.supabase.from("client_google_accounts").update({ active: linked }).eq("agency_id", context.agency.id).eq("client_id", clientId).eq("google_ad_account_id", accountId)
      : linked ? await context.supabase.from("client_google_accounts").insert({ agency_id: context.agency.id, client_id: clientId, google_ad_account_id: accountId, active: true }) : { error: null };
  if (error) return { error: "Não foi possível alterar o vínculo da conta." };
  revalidatePath("/integracoes");
  return { success: true as const };
}
