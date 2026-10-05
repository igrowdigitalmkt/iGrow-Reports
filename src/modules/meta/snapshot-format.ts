import Decimal from "decimal.js";

// Formatting is the only rounding boundary; values in the view stay exact.
export function formatSnapshotDecimal(value: string | null,unit: string,currency: string | null) {
  if (value === null) return "Indisponível";
  const amount = new Decimal(value);
  const precision = unit === "count" ? Math.min(amount.decimalPlaces(),6) : 2;
  const [integer,fraction] = amount.toFixed(precision).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g,".");
  const formatted = grouped + (fraction ? `,${fraction}` : "");
  if (unit === "currency") {
    if (!currency) return "Indisponível";
    const symbol = new Intl.NumberFormat("pt-BR",{ style: "currency",currency }).formatToParts(0)
      .find(part => part.type === "currency")?.value ?? currency;
    return `${symbol} ${formatted}`;
  }
  return formatted + (unit === "percent" ? "%" : "");
}
