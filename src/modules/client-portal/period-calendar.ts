import { shiftDate } from "./range";

/** Logica pura do calendario do seletor de periodo (datas AAAA-MM-DD, sempre em UTC para nao depender do fuso do navegador). */

export const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const monthTitleFormat = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

export const firstOfMonth = (iso: string) => `${iso.slice(0, 8)}01`;

/** "outubro de 2026", com a primeira letra maiuscula. */
export function monthTitle(monthStart: string) {
  const text = monthTitleFormat.format(new Date(`${monthStart}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Primeiro dia do mes deslocado em `delta` meses (negativo = anteriores). */
export function addMonths(monthStart: string, delta: number) {
  const date = new Date(`${monthStart}T12:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}

/** Semanas (domingo a sabado) do mes; celulas fora do mes vem como null. */
export function monthGrid(monthStart: string): Array<Array<string | null>> {
  const first = new Date(`${monthStart}T12:00:00Z`);
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = 0; day < days; day += 1) cells.push(shiftDate(monthStart, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** "01 de out. de 2026 – 19 de out. de 2026" (um unico dia vira so a data). */
export function rangeLabel(from: string, to: string) {
  const format = (iso: string) => shortDateFormat.format(new Date(`${iso}T12:00:00Z`));
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}

export const rangeDays = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;

/** Dois cliques no calendario: o primeiro ancora, o segundo fecha o intervalo (em qualquer ordem). */
export function pickDay(state: { anchor: string | null; from: string; to: string }, day: string) {
  if (!state.anchor) return { anchor: day, from: day, to: day };
  const [from, to] = day < state.anchor ? [day, state.anchor] : [state.anchor, day];
  return { anchor: null, from, to };
}

/** Mes da esquerda ao abrir: o do inicio do intervalo; se for o mes atual, mostra tambem o anterior. */
export function leftMonthFor(from: string, today: string) {
  const start = firstOfMonth(from);
  return start === firstOfMonth(today) ? addMonths(start, -1) : start;
}
