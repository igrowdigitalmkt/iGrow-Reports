export type AnalyticsPeriod = "today" | "yesterday" | "month" | "last-month"
  | "3d" | "7d" | "14d" | "30d" | "60d" | "90d" | "180d" | "365d" | "custom";

/** Atalhos da lista do seletor de periodo, na ordem de exibicao. (180d e 365d so existem para links antigos.) */
export const PERIOD_SHORTCUTS: ReadonlyArray<{ key: Exclude<AnalyticsPeriod, "custom" | "180d" | "365d">; label: string }> = [
  { key: "today", label: "Hoje" }, { key: "yesterday", label: "Ontem" },
  { key: "month", label: "Esse mês" }, { key: "last-month", label: "Último mês" },
  { key: "3d", label: "Últimos 3 dias" }, { key: "7d", label: "Últimos 7 dias" }, { key: "14d", label: "Últimos 14 dias" },
  { key: "30d", label: "Últimos 30 dias" }, { key: "60d", label: "Últimos 60 dias" }, { key: "90d", label: "Últimos 90 dias" },
];
export const PERIOD_LABELS: Record<string, string> = {
  ...Object.fromEntries(PERIOD_SHORTCUTS.map(item => [item.key, item.label])),
  "180d": "Últimos 180 dias", "365d": "Últimos 365 dias", custom: "Personalizado",
};

export function isRealIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}

export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const ROLLING_DAYS: Record<string, number> = { "3d": 3, "7d": 7, "14d": 14, "30d": 30, "60d": 60, "90d": 90, "180d": 180, "365d": 365 };

/**
 * Intervalo de cada atalho a partir de "hoje" (AAAA-MM-DD, no fuso da conta). "Ultimos N dias" termina ontem (dia completo);
 * "Hoje" e "Esse mes" incluem o dia atual. Devolve null para periodo personalizado ou desconhecido.
 */
export function presetRange(period: string, today: string): { dateFrom: string; dateTo: string } | null {
  if (Object.hasOwn(ROLLING_DAYS, period)) {
    const dateTo = shiftDate(today, -1);
    return { dateFrom: shiftDate(dateTo, 1 - ROLLING_DAYS[period]!), dateTo };
  }
  if (period === "today") return { dateFrom: today, dateTo: today };
  if (period === "yesterday") { const day = shiftDate(today, -1); return { dateFrom: day, dateTo: day }; }
  if (period === "month") return { dateFrom: `${today.slice(0, 8)}01`, dateTo: today };
  if (period === "last-month") {
    const dateTo = shiftDate(`${today.slice(0, 8)}01`, -1);
    return { dateFrom: `${dateTo.slice(0, 8)}01`, dateTo };
  }
  return null;
}

export function resolveAnalyticsRange(
  query: { periodo?: string; from?: string; to?: string },
  timezone: string | string[] = "America/Sao_Paulo",
  now = new Date(),
) {
  const timezones = Array.isArray(timezone) ? timezone : [timezone];
  const today = (timezones.length ? timezones : ["America/Sao_Paulo"]).map(timeZone => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const local = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${local.year}-${local.month}-${local.day}`;
  }).sort()[0];
  const period: AnalyticsPeriod = query.periodo === "custom" ? "custom" :
    presetRange(query.periodo ?? "", today) ? query.periodo as AnalyticsPeriod : "30d";
  const preset = period === "custom" ? null : presetRange(period, today);
  const dateTo = preset ? preset.dateTo : query.to ?? "";
  const dateFrom = preset ? preset.dateFrom : query.from ?? "";
  if (!isRealIsoDate(dateFrom) || !isRealIsoDate(dateTo)) {
    throw new Error("Informe datas válidas para o período personalizado.");
  }
  const days = Math.round((Date.parse(dateTo) - Date.parse(dateFrom)) / 86400000) + 1;
  if (days < 1 || days > 370) throw new Error("Escolha um período de 1 a 370 dias, com início anterior ao fim.");
  if (dateTo > today) throw new Error("O período não pode terminar em uma data futura.");
  return { period, dateFrom, dateTo, previousDateFrom: shiftDate(dateFrom, -days), previousDateTo: shiftDate(dateFrom, -1) };
}
