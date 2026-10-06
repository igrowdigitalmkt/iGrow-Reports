import type { ReportFrequency, ReportPeriodKey } from "@/types/database";

export type ScheduleRule = {
  frequency: ReportFrequency;
  weekdays: number[];
  monthDay: number;
  sendTime: string;
  timezone: string;
};

export const PERIOD_LABELS: Record<ReportPeriodKey, string> = {
  yesterday: "Ontem",
  last_7d: "Últimos 7 dias",
  last_14d: "Últimos 14 dias",
  last_30d: "Últimos 30 dias",
  this_month: "Este mês até ontem",
  last_month: "Mês passado",
};

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAY_LONG = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function wallClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
}

function offsetMs(date: Date, timeZone: string) {
  const w = wallClock(date, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(date: Date, timeZone: string) {
  const w = wallClock(date, timeZone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** The instant when the wall clock in `timeZone` shows `date` at `time`. */
export function zonedInstant(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetMs(new Date(guess), timeZone);
  instant = guess - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const monthStart = (date: string) => `${date.slice(0, 8)}01`;

/** Report dates for a run on `runDate` (local). Never includes the run day, which is still incomplete. */
export function resolvePeriod(period: ReportPeriodKey, runDate: string) {
  const yesterday = addDays(runDate, -1);
  switch (period) {
    case "yesterday": return { dateFrom: yesterday, dateTo: yesterday };
    case "last_7d": return { dateFrom: addDays(runDate, -7), dateTo: yesterday };
    case "last_14d": return { dateFrom: addDays(runDate, -14), dateTo: yesterday };
    case "last_30d": return { dateFrom: addDays(runDate, -30), dateTo: yesterday };
    // On the 1st there is no day of the current month yet: the whole previous month is sent.
    case "this_month": return { dateFrom: monthStart(yesterday), dateTo: yesterday };
    case "last_month": {
      const end = addDays(monthStart(runDate), -1);
      return { dateFrom: monthStart(end), dateTo: end };
    }
  }
}

function matches(rule: ScheduleRule, date: string) {
  if (rule.frequency === "daily") return true;
  if (rule.frequency === "weekly") return rule.weekdays.includes(weekday(date));
  return Number(date.slice(8, 10)) === rule.monthDay;
}

/** Upcoming send instants strictly after `after`. */
export function upcomingRuns(rule: ScheduleRule, after: Date, count: number) {
  const runs: Date[] = [];
  if (rule.frequency === "weekly" && !rule.weekdays.length) return runs;
  let date = localDate(after, rule.timezone);
  for (let guard = 0; guard < 400 && runs.length < count; guard += 1, date = addDays(date, 1)) {
    if (!matches(rule, date)) continue;
    const instant = zonedInstant(date, rule.sendTime, rule.timezone);
    if (instant.getTime() > after.getTime()) runs.push(instant);
  }
  return runs;
}

export function nextRunAt(rule: ScheduleRule, after: Date) {
  return upcomingRuns(rule, after, 1)[0] ?? null;
}

export function describeSchedule(rule: ScheduleRule) {
  const time = rule.sendTime.slice(0, 5);
  if (rule.frequency === "daily") return `Todos os dias às ${time}`;
  if (rule.frequency === "monthly") return `Todo dia ${rule.monthDay} às ${time}`;
  const days = [...rule.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (!days.length) return "Escolha ao menos um dia";
  if (days.length === 5 && days.every(day => day >= 1 && day <= 5)) return `De segunda a sexta às ${time}`;
  if (days.length === 7) return `Todos os dias às ${time}`;
  const names = days.map(day => WEEKDAY_LONG[day]);
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
  return `Toda semana: ${joined}, às ${time}`;
}
