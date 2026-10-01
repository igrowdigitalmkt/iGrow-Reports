export type AnalyticsPeriod = "7d" | "30d" | "90d" | "180d" | "365d" | "custom";

export function isRealIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveAnalyticsRange(
  query: { periodo?: string; from?: string; to?: string },
  timezone = "America/Sao_Paulo",
  now = new Date(),
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const local = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const today = `${local.year}-${local.month}-${local.day}`;
  const presets: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365 };
  const period: AnalyticsPeriod = query.periodo === "custom" ? "custom" :
    Object.hasOwn(presets, query.periodo ?? "") ? query.periodo as AnalyticsPeriod : "30d";
  const dateTo = period === "custom" ? query.to ?? "" : shiftDate(today, -1);
  const dateFrom = period === "custom" ? query.from ?? "" : shiftDate(dateTo, 1 - presets[period]);
  if (!isRealIsoDate(dateFrom) || !isRealIsoDate(dateTo)) {
    throw new Error("Informe datas válidas para o período personalizado.");
  }
  const days = Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000) + 1;
  if (days < 1 || days > 370) throw new Error("Escolha um período de 1 a 370 dias, com início anterior ao fim.");
  if (dateTo > today) throw new Error("O período não pode terminar em uma data futura.");
  return { period, dateFrom, dateTo, previousDateFrom: shiftDate(dateFrom, -days), previousDateTo: shiftDate(dateFrom, -1) };
}
