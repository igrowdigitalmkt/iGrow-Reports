import { dec, int, money } from "../format";
import type { ReportFacts } from "../report-facts";

export type TextPart = { text: string; bold?: boolean };

// Frase de abertura gerada por regra (sem IA): cita todos os tipos de resultado, cada um com o
// seu custo, e nunca escolhe um "resultado principal".
export function summaryParts(facts: ReportFacts): TextPart[] {
  const spend = facts.spend.current;
  const parts: TextPart[] = [{ text: "Neste período você investiu " }];
  parts.push({ text: spend == null ? "valor indisponível" : money(spend, facts.currency), bold: spend != null });
  const results = facts.results;
  if (results.length === 0) return [...parts, { text: "." }];
  parts.push({ text: " e obteve " });
  results.forEach((result, index) => {
    if (index > 0) parts.push({ text: index === results.length - 1 ? " e " : ", " });
    parts.push({ text: `${int(result.quantity)} ${result.label.toLocaleLowerCase("pt-BR")}`, bold: true });
    if (result.costPerResult != null) parts.push({ text: ` (${money(result.costPerResult, facts.currency)} cada)` });
  });
  parts.push({ text: "." });
  return parts;
}

export type Tone = "good" | "bad" | "neutral";

// Se subir é bom ou ruim depende da métrica: resultados e entrega sobem como bons, custos descem como bons,
// investimento é neutro (gastar mais ou menos não é bom nem ruim por si só).
export function toneFor(changePct: number | null, desirable: "up" | "down" | "neutral"): Tone {
  if (changePct == null || desirable === "neutral" || Math.abs(changePct) < 0.05) return "neutral";
  return (changePct > 0) === (desirable === "up") ? "good" : "bad";
}

export function changeLabel(changePct: number | null, comparable: boolean): string {
  if (!comparable) return "Sem comparação";
  if (changePct == null) return "Sem base de comparação";
  if (Math.abs(changePct) < 0.05) return "Sem variação";
  return `${changePct > 0 ? "+" : ""}${changePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. anterior`;
}

// Teto "redondo" para o eixo do gráfico (1, 2, 2,5, 5 ou 10 vezes uma potência de dez).
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return step * base;
}

export const frequencyText = (value: number | null) => value == null ? "Indisponível" : dec(value);
