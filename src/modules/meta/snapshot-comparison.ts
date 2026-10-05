import Decimal from "decimal.js";
import { confirmedMetaSnapshotScope } from "./snapshot-export";
import type { EntityLevel } from "../integrations/data-contract";
import type { MetaSnapshotEntityView, MetaSnapshotIndicator, MetaSnapshotView } from "./snapshot-view";
import { isRealIsoDate } from "../client-portal/range";

export type SnapshotMetricComparison = {
  status: "available" | "unavailable"; previousValue: string | null;
  absoluteChange: string | null; percentChange: string | null;
  reason: "missing_entity" | "missing_metric" | "unavailable_value" | "incompatible" | "zero_baseline" | null;
};
export function resolveSnapshotComparison(current: MetaSnapshotView, previous: MetaSnapshotView, account: string, level: EntityLevel) {
  const now = confirmedMetaSnapshotScope(current,account,level);
  const old = confirmedMetaSnapshotScope(previous,account,level);
  for (const key of ["clientId","connectionId","provider","externalAccountId","level","apiVersion","contractVersion"] as const) {
    if (now.identity[key] !== old.identity[key]) throw Error("Períodos com escopos incompatíveis.");
  }
  const dates = [now.identity.dateFrom,now.identity.dateTo,old.identity.dateFrom,old.identity.dateTo];
  if (!dates.every(isRealIsoDate)) throw Error("Períodos inválidos para comparação.");
  const [from,to,oldFrom,oldTo] = dates.map(date => Date.parse(`${date}T12:00:00Z`));
  if (from > to || oldFrom > oldTo || to-from !== oldTo-oldFrom || from-oldTo !== 86400000) throw Error("Compare períodos consecutivos com a mesma duração.");
  for (const scope of [now,old]) if (new Set(scope.entities.map(entity => entity.id)).size !== scope.entities.length) throw Error("Entidades duplicadas na comparação.");
  return { current: now,previous: old,previousEntities: new Map(old.entities.map(entity => [entity.id,entity])) };
}
export function compareSnapshotIndicator(current: MetaSnapshotIndicator, entity: MetaSnapshotEntityView, previous?: MetaSnapshotEntityView): SnapshotMetricComparison {
  const unavailable = (reason: SnapshotMetricComparison["reason"],previousValue: string | null = null): SnapshotMetricComparison => ({ status: "unavailable",reason,previousValue,absoluteChange: null,percentChange: null });
  if (!previous) return unavailable("missing_entity");
  const matches = previous.indicators.filter(metric => metric.key === current.key);
  if (matches.length !== 1) return unavailable("missing_metric");
  const old = matches[0];
  if (entity.currency !== previous.currency || entity.timezone !== previous.timezone || (entity.attributionWindow ?? null) !== (previous.attributionWindow ?? null) || old.nativeKey !== current.nativeKey || old.unit !== current.unit || old.aggregationRule !== current.aggregationRule) return unavailable("incompatible");
  if (!["available","zero"].includes(current.state) || !["available","zero"].includes(old.state) || current.value === null || old.value === null) return unavailable("unavailable_value",old.value);
  try {
    const parsedNow = new Decimal(current.value), parsedBefore = new Decimal(old.value);
    const span = Math.max(1,parsedNow.e+1,parsedBefore.e+1) + Math.max(parsedNow.decimalPlaces(),parsedBefore.decimalPlaces());
    if (!Number.isFinite(span) || span > 1000) return unavailable("unavailable_value");
    const Amount = Decimal.clone({ precision: Math.max(80,span+20) });
    const now = new Amount(current.value), before = new Amount(old.value);
    if (!now.isFinite() || !before.isFinite() || now.isNegative() || before.isNegative() || current.state === "zero" && !now.isZero() || old.state === "zero" && !before.isZero()) return unavailable("unavailable_value");
    const delta = now.minus(before);
    return { status: "available",previousValue: old.value,absoluteChange: delta.toFixed(),
      percentChange: before.isZero() ? null : delta.div(before).times(100).toFixed(6),reason: before.isZero() ? "zero_baseline" : null };
  } catch { return unavailable("unavailable_value"); }
}
export function snapshotComparisonDescription(result: SnapshotMetricComparison) {
  if (result.status === "unavailable") return result.reason === "missing_entity" ? "Entidade não retornada no período anterior."
    : result.reason === "missing_metric" ? "Indicador não retornado no período anterior."
      : result.reason === "incompatible" ? "Indicadores não comparáveis entre os períodos." : "Comparação indisponível para este indicador.";
  if (result.reason === "zero_baseline") return "Sem variação percentual: o valor anterior é zero.";
  const amount = new Decimal(result.percentChange!);
  return `Variação: ${amount.isPositive() && !amount.isZero() ? "+" : ""}${amount.toFixed(2).replace(".",",")}%`;
}
