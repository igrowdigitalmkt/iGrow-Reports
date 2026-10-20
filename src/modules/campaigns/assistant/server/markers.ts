import { verifyNumbers } from "@/modules/ai/number-guard";
import type { AssistantFacts, EntityFact } from "./facts";

// Marcadores verificáveis (mesmo conceito do motor de decisão do agente): o modelo cita valores de desempenho como {e1.spend},
// {e2.result1}, {e1.attributed1}, {e1.reference1} ou {d3}; o SERVIDOR escreve o valor confirmado, já formatado (com R$ e %).
// Marcador desconhecido, de dado ausente ou indisponível nunca vira número: vira "[dado indisponível]". O modelo não é a fonte de
// nenhum valor de desempenho nem faz conta. Valores de desempenho digitados à mão são rejeitados, mesmo que existam nos fatos.

export const UNAVAILABLE_TEXT = "[dado indisponível]";
const PLACEHOLDER = /\{([ed]\d{1,3})(?:\.([a-z_]+\d{0,2}))?\}/g;

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = (digits: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
function format(value: number, unit: "currency" | "integer" | "percent" | "ratio", currency: string) {
  if (unit === "currency") return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value).replace(/ /g, " ");
  if (unit === "percent") return `${decimal(1).format(value)}%`;
  return Number.isInteger(value) ? integer.format(value) : decimal(2).format(value);
}

function entityValue(entity: EntityFact, key: string): string | null {
  const metric = entity.metrics.find(item => item.key === key);
  if (metric) return metric.value != null && (metric.status === "confirmed" || metric.status === "zero_confirmed") ? format(metric.value, metric.unit, entity.currency) : null;
  const match = /^(result|attributed|reference)(\d{1,2})$/.exec(key);
  if (!match) return null;
  const result = entity.results.find(item => item.n === Number(match[2]));
  if (!result) return null;
  if (match[1] === "result") return format(result.value, "integer", entity.currency);
  const cost = match[1] === "attributed" ? result.attributedCost : result.referenceCostPerEvent;
  return cost == null ? null : format(cost, "currency", entity.currency);
}

/** Escreve os valores confirmados no lugar dos marcadores. */
export function renderMarkers(text: string, facts: AssistantFacts): string {
  const entities = new Map(facts.entities.map(entity => [entity.id, entity] as const));
  const derived = new Map(facts.derived.map(item => [item.id, item] as const));
  const rendered = text.replace(PLACEHOLDER, (_all, ref: string, key: string | undefined) => {
    if (ref.startsWith("d")) {
      const item = derived.get(ref);
      return item && !key ? format(item.value, item.unit, item.currency ?? "BRL") : UNAVAILABLE_TEXT;
    }
    const entity = entities.get(ref);
    return entity && key ? entityValue(entity, key) ?? UNAVAILABLE_TEXT : UNAVAILABLE_TEXT;
  });
  // O marcador já inclui R$ e %: se o modelo escreveu o símbolo junto, não duplica.
  return rendered.replace(/R\$\s*(?=R\$)/g, "").replace(/%\s*%/g, "%");
}

const tz = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const pad = (value: number | string) => String(value).padStart(2, "0");

/** Escritas aceitas para uma data ou horário dos fatos (dd/mm/aaaa, dd/mm, aaaa-mm-dd e hh:mm no horário de Brasília). */
function dateTokens(value: string | null): { tokens: string[]; year: number | null } {
  const time = Date.parse(value ?? "");
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  const tokens: string[] = [];
  let year: number | null = null;
  const add = (y: number, m: number, d: number) => {
    year = y;
    tokens.push(`${pad(d)}/${pad(m)}/${y}`, `${d}/${m}/${y}`, `${pad(d)}/${pad(m)}`, `${d}/${m}`, `${y}-${pad(m)}-${pad(d)}`);
  };
  if (day) add(Number(day[1]), Number(day[2]), Number(day[3]));
  if (Number.isFinite(time) && value && value.includes("T")) {
    const part = Object.fromEntries(tz.formatToParts(new Date(time)).map(item => [item.type, item.value]));
    add(Number(part.year), Number(part.month), Number(part.day));
    tokens.push(`${part.hour}:${part.minute}`, `${Number(part.hour)}:${part.minute}`);
  }
  return { tokens, year };
}

/**
 * O que o texto pode escrever LIVREMENTE: datas e horários dos fatos (escritos por inteiro, como dd/mm/aaaa ou hh:mm, nunca só o dia ou
 * o mês), o ano, a duração do período em dias, a idade da coleta em horas e contagens (entidades listadas, contas, tipos de resultado).
 * Nenhum valor de desempenho entra aqui: investimento, custos, resultados, percentuais e derivados só aparecem por marcador, associados à
 * entidade ou ao cálculo certo. Identificadores, versão e marcadores também não autorizam números.
 */
export function contextualAllowance(facts: AssistantFacts): { dates: string[]; numbers: string[] } {
  const dates = [facts.period.dateFrom, facts.period.dateTo, facts.source.collectedAt, facts.source.live.checkedAt, facts.generatedAt].map(dateTokens);
  const values: number[] = [facts.counts.included, facts.counts.available, facts.counts.truncated, facts.entities.length, facts.scope.accounts.length,
    facts.source.live.accountsRead, facts.source.live.accountsTotal, ...dates.flatMap(item => (item.year != null ? [item.year] : []))];
  const days = Math.round((Date.parse(facts.period.dateTo) - Date.parse(facts.period.dateFrom)) / 86_400_000) + 1;
  if (Number.isFinite(days)) values.push(days);
  if (facts.source.metricsAgeHours != null) values.push(facts.source.metricsAgeHours, Math.floor(facts.source.metricsAgeHours));
  for (const entity of facts.entities) values.push(entity.results.length);
  return { dates: [...new Set(dates.flatMap(item => item.tokens))].sort((a, b) => b.length - a.length), numbers: [values.filter(Number.isFinite).map(String).join(" ")] };
}

export type ChatVerification = { ok: true; text: string } | { ok: false; unverified: string[] };

/**
 * Confere a resposta ANTES de renderizar: retirados os marcadores, as datas e horários dos fatos e as ordinais ("1º"), todo número que
 * sobra precisa ser contextual (ver acima). Valor de desempenho digitado, número inventado ou valor de outra entidade escrito à mão
 * bloqueiam a resposta INTEIRA, sem trocar um número por outro. Só então os marcadores são escritos pelo servidor.
 * LIMITE: isto reduz, não elimina, o risco. Um marcador válido pode ser citado numa frase sobre a entidade errada, e a conferência não
 * valida o raciocínio nem a redação; não garante a correção semântica integral da resposta.
 */
export function verifyChatAnswer(text: string, facts: AssistantFacts): ChatVerification {
  const allowance = contextualAllowance(facts);
  let typed = text.replace(PLACEHOLDER, " ").replace(/\d{1,2}\s?[ºª°]/g, " ");
  for (const date of allowance.dates) typed = typed.split(date).join(" ");
  const check = verifyNumbers(typed, allowance.numbers);
  return check.ok ? { ok: true, text: renderMarkers(text, facts).trim() } : { ok: false, unverified: check.unverified.slice(0, 6) };
}
