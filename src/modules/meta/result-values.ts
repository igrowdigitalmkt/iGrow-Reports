import type { MetaInsight } from "./client";
import type { AnalyticsValues } from "@/modules/client-portal/analytics-types";

// Insights can contain an entity row even when it had no delivery. Meta then
// commonly omits both delivery metrics and Results instead of returning zeros.
export function isZeroDeliveryInsight(row: MetaInsight | undefined) {
  if (!row) return false;
  const hasIdentity = [row.account_id, row.campaign_id, row.adset_id, row.ad_id]
    .some((value) => typeof value === "string" && /^\d+$/.test(value));
  if (!hasIdentity) return false;
  const isZeroOrMissing = (value: unknown) =>
    value == null || ((typeof value === "string" || typeof value === "number") && Number(value) === 0);
  return isZeroOrMissing(row.spend) && isZeroOrMissing(row.impressions);
}

// Para o objetivo Cadastros (formulário instantâneo) a Meta não devolve o campo nativo "results" por campanha, embora o resultado dessa
// campanha seja sempre o lead do formulário. Só nesse objetivo, e só quando a linha trouxe as ações confirmadas, o resultado é o lead
// (a ação onsite_conversion.lead_grouped; sem ela, o próprio lead do pixel). Dia sem lead é zero. Qualquer outro objetivo continua
// desconhecido: ações secundárias não provam qual resultado a Meta escolheu.
const LEAD_FORM_ACTIONS = ["onsite_conversion.lead_grouped", "lead", "omni_lead", "offsite_conversion.fb_pixel_lead"];
function leadFormResultFallback(row: MetaInsight, counts: AnalyticsValues): AnalyticsValues | null {
  if (row.objective !== "OUTCOME_LEADS" || !Array.isArray(row.actions)) return null;
  let amount = 0;
  for (const type of LEAD_FORM_ACTIONS) {
    const entry = row.actions.find((action: unknown) => !!action && typeof action === "object" && (action as { action_type?: unknown }).action_type === type) as { value?: unknown } | undefined;
    if (!entry) continue;
    const raw = entry.value;
    if ((typeof raw !== "string" && typeof raw !== "number") || (typeof raw === "string" && !raw.trim())) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    amount = value;
    break;
  }
  counts["result:provider:action:onsite_conversion.lead_grouped"] = amount;
  return counts;
}

// Results are chosen by Meta for this entity's optimization goal. Secondary
// actions must remain separate metrics, rather than inflate the Results column.
export function providerResultValues(row: MetaInsight): AnalyticsValues | null {
  const counts: AnalyticsValues = { "result:provider_known": 1 };
  // Zero delivery is authoritative even if Meta emits an empty/partial Results
  // structure for the entity. It contributes zero and cannot invalidate totals.
  if (isZeroDeliveryInsight(row)) return counts;
  if (!Array.isArray(row.results)) return leadFormResultFallback(row, counts);
  for (const result of row.results) {
    if (!result || typeof result !== "object") return null;
    const entry = result as Record<string, unknown>;
    const indicator = typeof entry.indicator === "string" ? entry.indicator.replace(/^actions:/, "action:") : null;
    const list = Array.isArray(entry.values) ? entry.values : [];
    // Attribution windows are alternative views, not additive counts.
    if (!indicator || list.length !== 1 || !list[0] || typeof list[0] !== "object") return null;
    const raw = (list[0] as Record<string, unknown>).value;
    if ((typeof raw !== "string" && typeof raw !== "number") || (typeof raw === "string" && !raw.trim())) return null;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 0 || counts[`result:provider:${indicator}`] != null) return null;
    counts[`result:provider:${indicator}`] = amount;
  }
  return counts;
}

export function providerResultTotals(rows: MetaInsight[]): AnalyticsValues | null {
  const totals: AnalyticsValues = { "result:provider_known": 1 };
  for (const row of rows) {
    const values = providerResultValues(row);
    if (!values) return null;
    for (const [key, amount] of Object.entries(values)) {
      if (key.startsWith("result:provider:")) totals[key] = (totals[key] ?? 0) + (amount ?? 0);
    }
  }
  return totals;
}

// A campaign's actions include secondary outcomes. They cannot establish which
// outcome Meta selected for its Results column when that native field is absent.
export function campaignResultValues(row: MetaInsight): AnalyticsValues | null {
  return providerResultValues(row);
}

export function campaignResultTotals(rows: MetaInsight[]): AnalyticsValues | null {
  const totals: AnalyticsValues = { "result:provider_known": 1 };
  for (const row of rows) {
    const values = campaignResultValues(row);
    if (!values) return null;
    for (const [key, amount] of Object.entries(values)) {
      if (key.startsWith("result:provider:")) totals[key] = (totals[key] ?? 0) + (amount ?? 0);
    }
  }
  return totals;
}
