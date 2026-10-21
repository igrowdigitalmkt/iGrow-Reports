import "server-only";

import { ensurePaidOperation } from "@/modules/billing/guard";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { PlatformAccountSection } from "@/modules/platforms/provider";
import type { Database } from "@/types/database";
import type { GoogleAdsClient } from "./client";
import type { ClientAccountBilling } from "@/modules/meta/server";
import { googleAccountBilling } from "./billing";
import type { AnalyticsMetric } from "@/modules/client-portal/analytics-types";
import type { CampaignRow } from "@/modules/campaigns/tree";
import { buildGoogleRows } from "./hierarchy";
import { buildGoogleAnalytics, GOOGLE_METRICS, previousPeriod } from "./normalize";
import { accountDailyQuery, adGroupListQuery, adGroupQuery, adListQuery, adRowsQuery, campaignListQuery, campaignQuery } from "./queries";
import { loadGoogleAdsClient } from "./server";

type Service = SupabaseClient<Database>;

export type GoogleSectionsResult = { sections: PlatformAccountSection[]; failures: Array<{ name: string; message: string }> };

/** Contas do Google Ads vinculadas a CADA cliente da organização (só cadastro, sem consultar a API): cliente → contas. */
export async function googleAccountsByClient(service: Service, agencyId: string): Promise<Record<string, Array<{ id: string; name: string }>>> {
  const { data: links } = await service.from("client_google_accounts").select("client_id,google_ad_account_id").eq("agency_id", agencyId).eq("active", true);
  if (!links?.length) return {};
  const { data: accounts } = await service.from("google_ad_accounts").select("id,name").eq("agency_id", agencyId).is("archived_at", null);
  const names = new Map((accounts ?? []).map(account => [account.id, account.name]));
  const out: Record<string, Array<{ id: string; name: string }>> = {};
  for (const link of links) {
    const name = names.get(link.google_ad_account_id);
    if (name !== undefined) (out[link.client_id] ??= []).push({ id: link.google_ad_account_id, name });
  }
  return out;
}

/** Contas do Google Ads vinculadas ao cliente (ativas e não arquivadas). */
export async function linkedGoogleAccounts(service: Service, agencyId: string, clientId: string) {
  const { data: links } = await service.from("client_google_accounts").select("google_ad_account_id").eq("agency_id", agencyId).eq("client_id", clientId).eq("active", true);
  const ids = (links ?? []).map(link => link.google_ad_account_id);
  if (!ids.length) return [];
  const { data: accounts } = await service.from("google_ad_accounts").select("id,customer_id,name,currency,timezone_name,login_customer_id").eq("agency_id", agencyId).in("id", ids).is("archived_at", null).order("name");
  return (accounts ?? []).map(account => ({ id: account.id, customerId: account.customer_id, name: account.name, currency: account.currency, timezone: account.timezone_name, loginCustomerId: account.login_customer_id }));
}

/**
 * Números do Google Ads de cada conta vinculada ao cliente, lidos da API no momento (sem cópia no banco).
 * Uma conta que falha não derruba as outras: o motivo vem em `failures` para o relatório avisar.
 */
export async function loadGoogleSections(input: { service: Service; agencyId: string; clientId: string; dateFrom: string; dateTo: string; accountIds?: string[]; client?: GoogleAdsClient }): Promise<GoogleSectionsResult> {
  // Leitura ao vivo é consulta nova ao provedor (não há histórico guardado): com acesso restrito não é usada para contornar a restrição.
  await ensurePaidOperation(input.agencyId);
  const linked = (await linkedGoogleAccounts(input.service, input.agencyId, input.clientId)).filter(account => !input.accountIds || input.accountIds.includes(account.id));
  if (!linked.length) return { sections: [], failures: [] };
  const client = input.client ?? (await loadGoogleAdsClient(input.service, input.agencyId)).client;
  const previous = previousPeriod(input.dateFrom, input.dateTo);
  type Outcome = { section?: PlatformAccountSection; failure?: { name: string; message: string } };
  const results: Outcome[] = await Promise.all(linked.map(async (account): Promise<Outcome> => {
    try {
      const [daily, previousDaily, campaigns, campaignList] = await Promise.all([
        client.search(account.customerId, accountDailyQuery(input.dateFrom, input.dateTo), { loginCustomerId: account.loginCustomerId }),
        client.search(account.customerId, accountDailyQuery(previous.from, previous.to), { loginCustomerId: account.loginCustomerId }),
        client.search(account.customerId, campaignQuery(input.dateFrom, input.dateTo), { loginCustomerId: account.loginCustomerId }),
        // A lista completa só acrescenta campanhas sem atividade no período; se falhar, a leitura segue como antes.
        client.search(account.customerId, campaignListQuery(), { loginCustomerId: account.loginCustomerId }).catch(() => undefined),
      ]);
      const data: AnalyticsDashboardData = buildGoogleAnalytics({ account, dateFrom: input.dateFrom, dateTo: input.dateTo, rows: { daily, previousDaily, campaigns, campaignList } });
      return { section: { id: account.id, name: account.name, data } };
    } catch (error) {
      return { failure: { name: account.name, message: error instanceof Error ? error.message : "Falha ao ler o Google Ads." } };
    }
  }));
  return { sections: results.flatMap(result => result.section ? [result.section] : []), failures: results.flatMap(result => result.failure ? [result.failure] : []) };
}

const customerStatusQuery = "SELECT customer.status, customer.currency_code FROM customer LIMIT 1";
const accountBudgetQuery = "SELECT account_budget.status, account_budget.approved_spending_limit_micros, account_budget.adjusted_spending_limit_micros, account_budget.amount_served_micros FROM account_budget WHERE account_budget.status = 'APPROVED'";

/** Situação e limite (somente leitura) de cada conta do Google Ads vinculada ao cliente. Uma conta que falha vira aviso, não derruba as outras. */
export async function loadGoogleBilling(input: { service: Service; agencyId: string; clientId: string; client?: GoogleAdsClient }): Promise<{ accounts: ClientAccountBilling[]; failures: string[] }> {
  await ensurePaidOperation(input.agencyId);
  const linked = await linkedGoogleAccounts(input.service, input.agencyId, input.clientId);
  if (!linked.length) return { accounts: [], failures: [] };
  const client = input.client ?? (await loadGoogleAdsClient(input.service, input.agencyId)).client;
  const results = await Promise.all(linked.map(async account => {
    try {
      const customer = await client.search(account.customerId, customerStatusQuery, { loginCustomerId: account.loginCustomerId });
      // Orçamento da conta só existe em contas com fatura ou pré-pago: a falta dele (ou a recusa da API) não é erro da conta.
      const budgets = await client.search(account.customerId, accountBudgetQuery, { loginCustomerId: account.loginCustomerId }).catch(() => null);
      return { account: googleAccountBilling({ id: account.id, name: account.name, currency: account.currency, customerRow: customer[0], budgetRows: budgets }) };
    } catch {
      return { failure: account.name };
    }
  }));
  return { accounts: results.flatMap(result => "account" in result && result.account ? [result.account] : []), failures: results.flatMap(result => "failure" in result && result.failure ? [result.failure] : []) };
}

export type GoogleCampaignsData = {
  accounts: Array<{ id: string; name: string; currency: string }>;
  /** Campanhas, grupos de anúncios e anúncios no mesmo formato das linhas da Meta (só leitura). */
  rows: CampaignRow[];
  metrics: AnalyticsMetric[];
  failures: Array<{ name: string; message: string }>;
  readAt: string;
};

/**
 * Hierarquia completa do Google Ads (campanhas › grupos de anúncios › anúncios) das contas vinculadas ao cliente, lida ao vivo no
 * período informado. Itens sem atividade no período vêm da lista completa, com estado; uma conta que falha vira aviso, não derruba as outras.
 */
export async function loadGoogleCampaignRows(input: { service: Service; agencyId: string; clientId: string; dateFrom: string; dateTo: string; client?: GoogleAdsClient }): Promise<GoogleCampaignsData> {
  await ensurePaidOperation(input.agencyId);
  const linked = await linkedGoogleAccounts(input.service, input.agencyId, input.clientId);
  const readAt = new Date().toISOString();
  if (!linked.length) return { accounts: [], rows: [], metrics: GOOGLE_METRICS as AnalyticsMetric[], failures: [], readAt };
  const client = input.client ?? (await loadGoogleAdsClient(input.service, input.agencyId)).client;
  const results = await Promise.all(linked.map(async account => {
    const options = { loginCustomerId: account.loginCustomerId };
    const search = (query: string) => client.search(account.customerId, query, options);
    try {
      const [campaigns, campaignList, adGroups, adGroupList, ads, adList] = await Promise.all([
        search(campaignQuery(input.dateFrom, input.dateTo)), search(campaignListQuery()).catch(() => undefined),
        search(adGroupQuery(input.dateFrom, input.dateTo)), search(adGroupListQuery()).catch(() => undefined),
        search(adRowsQuery(input.dateFrom, input.dateTo)), search(adListQuery()).catch(() => undefined),
      ]);
      const gaccount = { id: account.id, customerId: account.customerId, name: account.name, currency: account.currency, timezone: account.timezone ?? "America/Sao_Paulo" };
      return { account: { id: account.id, name: account.name, currency: account.currency }, rows: buildGoogleRows(gaccount, { campaigns, campaignList, adGroups, adGroupList, ads, adList }) };
    } catch (error) {
      return { failure: { name: account.name, message: error instanceof Error ? error.message : "Falha ao ler o Google Ads." } };
    }
  }));
  return {
    accounts: results.flatMap(result => "account" in result && result.account ? [result.account] : []),
    rows: results.flatMap(result => "rows" in result && result.rows ? result.rows : []),
    metrics: GOOGLE_METRICS as AnalyticsMetric[], readAt,
    failures: results.flatMap(result => "failure" in result && result.failure ? [result.failure] : []),
  };
}
