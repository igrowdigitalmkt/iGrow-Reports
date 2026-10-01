import Decimal from "decimal.js";
import type { Database } from "@/types/database";
import type { MetaAction, MetaInsight } from "./client";

const DAY_MS = 86_400_000;

export function parseCollectionDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Data inválida.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Data inválida.");
  }
  return parsed;
}

export function validateCollectionRange(since: string, until: string) {
  const from = parseCollectionDate(since);
  const to = parseCollectionDate(until);
  const days = (to.getTime() - from.getTime()) / DAY_MS + 1;
  if (days < 1 || days > 370) throw new Error("Escolha um período de até 370 dias.");
  return { since, until, days };
}

export function splitCollectionRange(since: string, until: string) {
  validateCollectionRange(since, until);
  const end = parseCollectionDate(until).getTime();
  const slices: Array<{ since: string; until: string }> = [];
  for (let start = parseCollectionDate(since).getTime(); start <= end; start += 30 * DAY_MS) {
    slices.push({
      since: new Date(start).toISOString().slice(0, 10),
      until: new Date(Math.min(end, start + 29 * DAY_MS)).toISOString().slice(0, 10),
    });
  }
  return slices;
}

function numeric(value: string | undefined, fallback: number | null = null) {
  if (value === undefined) return fallback;
  const parsed = new Decimal(value);
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error("Métrica Meta inválida.");
  return parsed.toNumber();
}

function actionMetric(values: MetaAction[] | undefined, type: string) {
  if (!values) return null;
  return values.filter((entry) => entry.action_type === type)
    .reduce((total, entry) => total + (numeric(entry.value, 0) ?? 0), 0);
}

export function periodInsightMetrics(insight: MetaInsight | undefined) {
  return {
    reach: numeric(insight?.reach),
    frequency: numeric(insight?.frequency),
    unique_clicks: numeric(insight?.unique_clicks),
  };
}

export function normalizeInsightSlice(input: {
  agencyId: string;
  accountId: string;
  externalAccountId: string;
  since: string;
  until: string;
  timezoneName: string;
  businessId: string;
  apiVersion: string;
  collectedAt: string;
  accountInsights: MetaInsight[];
  campaignInsights: MetaInsight[];
}) {
  const insights: Database["public"]["Tables"]["meta_daily_insights"]["Insert"][] = [];
  const actions: Database["public"]["Tables"]["meta_daily_actions"]["Insert"][] = [];
  for (const level of ["account", "campaign"] as const) {
    for (const insight of level === "account" ? input.accountInsights : input.campaignInsights) {
      parseCollectionDate(insight.date_start);
      if (insight.date_start < input.since || insight.date_start > input.until
        || insight.date_stop !== insight.date_start
        || (insight.account_id && `act_${insight.account_id}` !== input.externalAccountId)) {
        throw new Error("A Meta retornou dados fora da conta ou do período solicitado.");
      }
      const externalEntityId = level === "account" ? input.externalAccountId : insight.campaign_id;
      if (!externalEntityId || (level === "campaign" && !/^\d+$/.test(externalEntityId))) {
        throw new Error("A Meta retornou uma campanha sem identificador válido.");
      }
      const key = {
        agency_id: input.agencyId,
        ad_account_id: input.accountId,
        insight_date: insight.date_start,
        level,
        external_entity_id: externalEntityId,
        collected_at: input.collectedAt,
      };
      insights.push({
        ...key,
        parent_external_id: level === "campaign" ? input.externalAccountId : null,
        entity_name: (level === "account" ? insight.account_name : insight.campaign_name) ?? null,
        objective: insight.objective ?? null,
        spend: numeric(insight.spend, 0)!,
        impressions: numeric(insight.impressions, 0)!,
        reach: numeric(insight.reach),
        link_clicks: numeric(insight.inline_link_clicks),
        api_version: input.apiVersion,
        metadata: {
          timezone_name: input.timezoneName,
          business_id: input.businessId,
          clicks: numeric(insight.clicks),
          unique_clicks: numeric(insight.unique_clicks),
          frequency: numeric(insight.frequency),
          inline_post_engagement: numeric(insight.inline_post_engagement),
          outbound_clicks: actionMetric(insight.outbound_clicks, "outbound_click"),
          unique_outbound_clicks: actionMetric(insight.unique_outbound_clicks, "outbound_click"),
          video_play_actions: actionMetric(insight.video_play_actions, "video_view"),
          video_p25_watched_actions: actionMetric(insight.video_p25_watched_actions, "video_view"),
          video_p50_watched_actions: actionMetric(insight.video_p50_watched_actions, "video_view"),
          video_p75_watched_actions: actionMetric(insight.video_p75_watched_actions, "video_view"),
          video_p95_watched_actions: actionMetric(insight.video_p95_watched_actions, "video_view"),
          video_p100_watched_actions: actionMetric(insight.video_p100_watched_actions, "video_view"),
        },
      });
      const normalized = new Map<string, { count: Decimal; value: Decimal | null }>();
      for (const action of insight.actions ?? []) {
        const entry = normalized.get(action.action_type) ?? { count: new Decimal(0), value: null };
        entry.count = entry.count.add(numeric(action.value, 0)!);
        normalized.set(action.action_type, entry);
      }
      for (const action of insight.action_values ?? []) {
        const entry = normalized.get(action.action_type) ?? { count: new Decimal(0), value: null };
        entry.value = (entry.value ?? new Decimal(0)).add(numeric(action.value, 0)!);
        normalized.set(action.action_type, entry);
      }
      for (const [actionType, entry] of normalized) {
        if (!actionType.trim() || actionType.length > 240) throw new Error("Ação Meta inválida.");
        actions.push({ ...key, action_type: actionType, action_value: entry.count.toNumber(), value_amount: entry.value?.toNumber() ?? null });
      }
    }
  }
  return { insights, actions };
}
