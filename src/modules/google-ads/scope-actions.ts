"use server";

import { z } from "zod";
import { billingBlockOf } from "@/modules/billing/guard";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireClientDashboardAccess } from "@/modules/client-portal/context";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { buildGoogleAnalytics, previousPeriod, sumDailyByDate } from "./normalize";
import { campaignDailyQuery, campaignQuery } from "./queries";
import { linkedGoogleAccounts } from "./provider";
import { loadGoogleAdsClient } from "./server";

const schema = z.object({
  clientId: z.uuid(), accountId: z.uuid(), dateFrom: z.iso.date(), dateTo: z.iso.date(),
  campaignIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(200),
});

export type GoogleScopeResult = { ok: true; data: AnalyticsDashboardData } | { ok: false; message: string };

/**
 * Recalcula o período de UMA conta do Google Ads só com as campanhas escolhidas (resumo, dias e período anterior), lendo a API ao vivo.
 * Somente leitura. A conta precisa estar vinculada ao cliente da sessão e os identificadores são validados antes de entrar na consulta.
 */
export async function loadGoogleScopeAction(input: unknown): Promise<GoogleScopeResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Seleção de campanhas inválida." };
  const { clientId, accountId, dateFrom, dateTo, campaignIds } = parsed.data;
  const { access } = await requireClientDashboardAccess(clientId);
  const service = createSupabaseServiceClient();
  if (!service) return { ok: false, message: "Não foi possível consultar o Google Ads agora." };
  try {
    const account = (await linkedGoogleAccounts(service, access.agencyId, clientId)).find(item => item.id === accountId);
    if (!account) return { ok: false, message: "Conta do Google Ads não encontrada para este cliente." };
    const { client } = await loadGoogleAdsClient(service, access.agencyId);
    const previous = previousPeriod(dateFrom, dateTo);
    const options = { loginCustomerId: account.loginCustomerId };
    const [daily, previousDaily, campaigns] = await Promise.all([
      client.search(account.customerId, campaignDailyQuery(dateFrom, dateTo, campaignIds), options),
      client.search(account.customerId, campaignDailyQuery(previous.from, previous.to, campaignIds), options),
      client.search(account.customerId, campaignQuery(dateFrom, dateTo), options),
    ]);
    const chosen = new Set(campaignIds);
    const rows = {
      daily: sumDailyByDate(daily), previousDaily: sumDailyByDate(previousDaily),
      campaigns: campaigns.filter(row => chosen.has(String((row.campaign as { id?: unknown } | undefined)?.id ?? ""))),
    };
    const data = buildGoogleAnalytics({ account: { id: account.id, customerId: account.customerId, name: account.name, currency: account.currency, timezone: account.timezone ?? "America/Sao_Paulo" }, dateFrom, dateTo, rows });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: billingBlockOf(error)?.error ?? "Não foi possível aplicar a seleção agora. Tente novamente em instantes." };
  }
}
