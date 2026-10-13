import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { PlatformAccountSection } from "@/modules/platforms/provider";
import type { Database } from "@/types/database";
import type { GoogleAdsClient } from "./client";
import { buildGoogleAnalytics, previousPeriod } from "./normalize";
import { accountDailyQuery, campaignQuery } from "./queries";
import { loadGoogleAdsClient } from "./server";

type Service = SupabaseClient<Database>;

export type GoogleSectionsResult = { sections: PlatformAccountSection[]; failures: Array<{ name: string; message: string }> };

/** Contas do Google Ads vinculadas ao cliente (ativas e não arquivadas). */
export async function linkedGoogleAccounts(service: Service, agencyId: string, clientId: string) {
  const { data: links } = await service.from("client_google_accounts").select("google_ad_account_id").eq("agency_id", agencyId).eq("client_id", clientId).eq("active", true);
  const ids = (links ?? []).map(link => link.google_ad_account_id);
  if (!ids.length) return [];
  const { data: accounts } = await service.from("google_ad_accounts").select("id,customer_id,name,currency,timezone_name").eq("agency_id", agencyId).in("id", ids).is("archived_at", null).order("name");
  return (accounts ?? []).map(account => ({ id: account.id, customerId: account.customer_id, name: account.name, currency: account.currency, timezone: account.timezone_name }));
}

/**
 * Números do Google Ads de cada conta vinculada ao cliente, lidos da API no momento (sem cópia no banco).
 * Uma conta que falha não derruba as outras: o motivo vem em `failures` para o relatório avisar.
 */
export async function loadGoogleSections(input: { service: Service; agencyId: string; clientId: string; dateFrom: string; dateTo: string; accountIds?: string[]; client?: GoogleAdsClient }): Promise<GoogleSectionsResult> {
  const linked = (await linkedGoogleAccounts(input.service, input.agencyId, input.clientId)).filter(account => !input.accountIds || input.accountIds.includes(account.id));
  if (!linked.length) return { sections: [], failures: [] };
  const client = input.client ?? (await loadGoogleAdsClient(input.service, input.agencyId)).client;
  const previous = previousPeriod(input.dateFrom, input.dateTo);
  type Outcome = { section?: PlatformAccountSection; failure?: { name: string; message: string } };
  const results: Outcome[] = await Promise.all(linked.map(async (account): Promise<Outcome> => {
    try {
      const [daily, previousDaily, campaigns] = await Promise.all([
        client.search(account.customerId, accountDailyQuery(input.dateFrom, input.dateTo)),
        client.search(account.customerId, accountDailyQuery(previous.from, previous.to)),
        client.search(account.customerId, campaignQuery(input.dateFrom, input.dateTo)),
      ]);
      const data: AnalyticsDashboardData = buildGoogleAnalytics({ account, dateFrom: input.dateFrom, dateTo: input.dateTo, rows: { daily, previousDaily, campaigns } });
      return { section: { id: account.id, name: account.name, data } };
    } catch (error) {
      return { failure: { name: account.name, message: error instanceof Error ? error.message : "Falha ao ler o Google Ads." } };
    }
  }));
  return { sections: results.flatMap(result => result.section ? [result.section] : []), failures: results.flatMap(result => result.failure ? [result.failure] : []) };
}
