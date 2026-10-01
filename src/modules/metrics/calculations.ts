import Decimal from "decimal.js";

export type DecimalInput = string | number | Decimal | null | undefined;

export type DerivedMetrics = {
  spend: string | null;
  impressions: string | null;
  linkClicks: string | null;
  primaryResults: string | null;
  attributedRevenue: string | null;
  ctrLink: string | null;
  cpcLink: string | null;
  cpm: string | null;
  costPerResult: string | null;
  roas: string | null;
};

export type Variation =
  | { status: "ok"; value: string }
  | { status: "no_base"; value: null }
  | { status: "unavailable"; value: null };

function decimal(value: DecimalInput): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = value instanceof Decimal ? value : new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function serialize(value: Decimal | null): string | null {
  return value === null ? null : value.toFixed();
}

export function safeDivide(
  numerator: DecimalInput,
  denominator: DecimalInput,
  multiplier: DecimalInput = 1,
): string | null {
  const n = decimal(numerator);
  const d = decimal(denominator);
  const m = decimal(multiplier);
  if (!n || !d || !m || d.isZero()) return null;
  return serialize(n.div(d).mul(m));
}

export function sumDecimal(values: DecimalInput[]): string | null {
  let total = new Decimal(0);
  let found = false;
  for (const value of values) {
    const parsed = decimal(value);
    if (!parsed) continue;
    found = true;
    total = total.add(parsed);
  }
  return found ? total.toFixed() : null;
}

export function calculateDerivedMetrics(input: {
  spend: DecimalInput;
  impressions: DecimalInput;
  linkClicks: DecimalInput;
  primaryResults?: DecimalInput;
  attributedRevenue?: DecimalInput;
}): DerivedMetrics {
  const spend = decimal(input.spend);
  const impressions = decimal(input.impressions);
  const linkClicks = decimal(input.linkClicks);
  const primaryResults = decimal(input.primaryResults);
  const attributedRevenue = decimal(input.attributedRevenue);

  return {
    spend: serialize(spend),
    impressions: serialize(impressions),
    linkClicks: serialize(linkClicks),
    primaryResults: serialize(primaryResults),
    attributedRevenue: serialize(attributedRevenue),
    ctrLink: safeDivide(linkClicks, impressions, 100),
    cpcLink: safeDivide(spend, linkClicks),
    cpm: safeDivide(spend, impressions, 1000),
    costPerResult: safeDivide(spend, primaryResults),
    roas: safeDivide(attributedRevenue, spend),
  };
}

export function calculateVariation(
  current: DecimalInput,
  previous: DecimalInput,
): Variation {
  const now = decimal(current);
  const before = decimal(previous);
  if (!now || !before) return { status: "unavailable", value: null };
  if (before.isZero()) return { status: "no_base", value: null };
  return {
    status: "ok",
    value: now.minus(before).div(before).mul(100).toFixed(),
  };
}

export function compareDirection(
  variation: Variation,
  desirableDirection: "up" | "down" | "neutral",
): "favorable" | "unfavorable" | "neutral" | "unavailable" {
  if (variation.status !== "ok") return "unavailable";
  if (desirableDirection === "neutral") return "neutral";
  const value = new Decimal(variation.value);
  if (value.isZero()) return "neutral";
  const favorable = desirableDirection === "up" ? value.gt(0) : value.lt(0);
  return favorable ? "favorable" : "unfavorable";
}
