import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { ClientMetricSummaryRow, Database } from "@/types/database";

export type ClientPortalPeriod = "7d" | "30d";

export type ClientPortalDataContext = {
  dataStatus: string;
  compatibilityIssue: string | null;
  currency: string | null;
  timezoneName: string | null;
  adAccountCount: number;
  latestDataDate: string | null;
};

export type ClientPortalMetricView = {
  context: ClientPortalDataContext;
  period: ClientPortalPeriod;
  dateFrom: string | null;
  dateTo: string | null;
  summary: ClientMetricSummaryRow | null;
};

export function normalizePortalPeriod(value: string | undefined): ClientPortalPeriod {
  return value === "7d" ? "7d" : "30d";
}

function localIsoDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function getCompletePortalPeriod(
  period: ClientPortalPeriod,
  timeZone: string,
  now = new Date(),
) {
  const days = period === "7d" ? 7 : 30;
  const today = localIsoDate(now, timeZone);
  const dateTo = shiftIsoDate(today, -1);
  const dateFrom = shiftIsoDate(dateTo, -(days - 1));
  return { dateFrom, dateTo };
}

export async function getClientPortalMetricView(
  supabase: SupabaseClient<Database>,
  clientId: string,
  period: ClientPortalPeriod,
  now = new Date(),
): Promise<ClientPortalMetricView> {
  const contextResult = await supabase
    .rpc("get_client_portal_data_context", { p_client_id: clientId })
    .single();

  if (contextResult.error || !contextResult.data) {
    if (isMissingSchemaError(contextResult.error)) {
      return {
        context: {
          dataStatus: "setup_pending",
          compatibilityIssue: null,
          currency: null,
          timezoneName: null,
          adAccountCount: 0,
          latestDataDate: null,
        },
        period,
        dateFrom: null,
        dateTo: null,
        summary: null,
      };
    }
    throw new Error("Não foi possível consultar o contexto de dados deste cliente.");
  }

  const context: ClientPortalDataContext = {
    dataStatus: contextResult.data.data_status,
    compatibilityIssue: contextResult.data.compatibility_issue,
    currency: contextResult.data.currency,
    timezoneName: contextResult.data.timezone_name,
    adAccountCount: contextResult.data.ad_account_count,
    latestDataDate: contextResult.data.latest_data_date,
  };

  if (context.dataStatus !== "ok" || !context.timezoneName) {
    return { context, period, dateFrom: null, dateTo: null, summary: null };
  }

  const { dateFrom, dateTo } = getCompletePortalPeriod(period, context.timezoneName, now);
  const summaryResult = await supabase
    .rpc("get_client_portal_metric_summary", {
      p_client_id: clientId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    })
    .single();

  if (summaryResult.error || !summaryResult.data) {
    throw new Error("Não foi possível consultar os indicadores deste cliente.");
  }

  return {
    context,
    period,
    dateFrom,
    dateTo,
    summary: summaryResult.data,
  };
}
