import "server-only";

import { ensurePaidOperation } from "@/modules/billing/guard";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { PlatformAccountSection } from "@/modules/platforms/provider";
import type { Database } from "@/types/database";
import type { GoogleAdsClient } from "./client";
import type { ClientAccountBilling, GoogleBillingProbe } from "@/modules/meta/server";
import { googleAccountBilling } from "./billing";
import type { AnalyticsMetric } from "@/modules/client-portal/analytics-types";
import type { CampaignRow } from "@/modules/campaigns/tree";
import { buildGoogleRows } from "./hierarchy";
import { buildGoogleAnalytics, GOOGLE_METRICS, previousPeriod } from "./normalize";
import { estimateCredit, type CreditEntry } from "./credit-balance";
import { spendBetweenQuery, accountBudgetQuery, accountDailyQuery, billingSetupQuery, campaignBudgetsQuery, monthCostQuery, adGroupListQuery, adGroupQuery, adListQuery, adRowsQuery, campaignListQuery, campaignQuery } from "./queries";
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

/**
 * Situação e pagamento (somente leitura) de cada conta do Google Ads vinculada ao cliente, lendo TODAS as fontes que a API oferece:
 * estado da conta, orçamento da conta e cobrança (faturamento mensal), gasto do mês e orçamentos de campanha. Uma fonte que falha ou
 * não existe para a conta vira um registro em `google.probes` (não é erro da conta); uma conta que falha por inteiro vira aviso.
 */
export async function loadGoogleBilling(input: { service: Service; agencyId: string; clientId: string; client?: GoogleAdsClient }): Promise<{ accounts: ClientAccountBilling[]; failures: string[] }> {
  await ensurePaidOperation(input.agencyId);
  const linked = await linkedGoogleAccounts(input.service, input.agencyId, input.clientId);
  if (!linked.length) return { accounts: [], failures: [] };
  const client = input.client ?? (await loadGoogleAdsClient(input.service, input.agencyId)).client;
  // Créditos informados pelo usuário (ainda não removidos): base da estimativa de saldo.
  const { data: creditRows } = await input.service.from("google_account_credits").select("id,google_ad_account_id,amount,currency,deposited_on,note,created_at")
    .eq("agency_id", input.agencyId).in("google_ad_account_id", linked.map(account => account.id)).is("removed_at", null).order("deposited_on");
  const creditsOf = (accountId: string): CreditEntry[] => (creditRows ?? []).filter(row => row.google_ad_account_id === accountId)
    .map(row => ({ id: row.id, amount: Number(row.amount), currency: row.currency, depositedOn: row.deposited_on, note: row.note, createdAt: row.created_at }));
  const results = await Promise.all(linked.map(async account => {
    const options = { loginCustomerId: account.loginCustomerId };
    const probes: GoogleBillingProbe[] = [];
    const probe = async (source: string, query: string) => {
      try {
        const rows = await client.search(account.customerId, query, options);
        probes.push({ source, state: rows.length ? "ok" : "empty", ...(rows.length ? { sample: JSON.stringify(rows.slice(0, 3)).slice(0, 1500) } : {}) });
        return rows;
      } catch (error) {
        probes.push({ source, state: "error", message: error instanceof Error ? error.message : "Falha ao ler esta fonte." });
        return null;
      }
    };
    try {
      const customer = await client.search(account.customerId, customerStatusQuery, options);
      const [accountBudgetRows, billingSetupRows, monthCostRows, campaignBudgetRows] = await Promise.all([
        probe("orçamento da conta", accountBudgetQuery()), probe("cobrança da conta", billingSetupQuery()),
        probe("gasto do mês", monthCostQuery()), probe("orçamentos das campanhas", campaignBudgetsQuery()),
      ]);
      // Fontes fora do GAQL (somente leitura): contas de pagamento e as faturas do mês e do mês anterior da cobrança aprovada.
      const readRest = async (source: string, path: string) => {
        try { const body = await client.readBilling(path, options); probes.push({ source, state: Object.keys(body).length ? "ok" : "empty", sample: JSON.stringify(body).slice(0, 1500) }); }
        catch (error) { probes.push({ source, state: "error", message: error instanceof Error ? error.message : "Falha ao ler esta fonte." }); }
      };
      const customerPath = `customers/${account.customerId.replace(/-/g, "")}`;
      await readRest("contas de pagamento", `${customerPath}/paymentsAccounts`);
      const setup = (billingSetupRows ?? []).map(row => (row.billingSetup ?? {}) as Record<string, unknown>).find(item => typeof item.resourceName === "string");
      const setupId = typeof setup?.resourceName === "string" ? /billingSetups\/(\d+)$/.exec(setup.resourceName)?.[1] : undefined;
      if (setupId) {
        const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
        const now = new Date();
        const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        for (const date of [now, previous]) {
          await readRest(`faturas de ${months[date.getMonth()]!.toLowerCase()}/${date.getFullYear()}`,
            `${customerPath}/invoices?billingSetup=${encodeURIComponent(`${customerPath}/billingSetups/${setupId}`)}&issueYear=${date.getFullYear()}&issueMonth=${months[date.getMonth()]}`);
        }
      }
      // Gasto desde o primeiro crédito informado (calendário da conta): o saldo estimado é créditos − esse gasto.
      const entries = creditsOf(account.id);
      let credit = null;
      if (entries.length) {
        const from = entries.map(entry => entry.depositedOn).sort()[0]!;
        const until = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
        const spentRows = await probe("gasto desde o primeiro crédito informado", spendBetweenQuery(from, until));
        if (spentRows) credit = estimateCredit(entries, spentRows.reduce((total, row) => total + (Number(((row.metrics ?? {}) as Record<string, unknown>).costMicros) || 0), 0) / 1_000_000);
      }
      const built = googleAccountBilling({ id: account.id, name: account.name, currency: account.currency, customerRow: customer[0], accountBudgetRows, billingSetupRows, monthCostRows, campaignBudgetRows, probes });
      return { account: built.google ? { ...built, google: { ...built.google, ...(credit ? { credit } : {}) } } : built };
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
