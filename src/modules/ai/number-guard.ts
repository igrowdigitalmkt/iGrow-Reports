// Verificador de números: todo valor citado num texto gerado por IA precisa existir nos fatos
// confirmados que foram entregues a ela. A IA escreve; ela nunca é a fonte de um número.

const NUMBER = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g;

// "1.260" e "1260" -> "1260"; "18,5" -> "18.5"; zeros à direita da fração são ignorados.
export function normalizeNumber(token: string): string {
  const plain = token.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  if (!plain.includes(".")) return String(Number(plain));
  const [whole = "0", fraction = ""] = plain.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${Number(whole)}.${trimmed}` : String(Number(whole));
}

// Marcadores de lista ("1.", "2)") no início da linha não são valores citados.
const LIST_MARKER = /^[ \t]*\d{1,2}[.)](?=\s)/gm;

export function extractNumbers(text: string): string[] {
  return (text.replace(LIST_MARKER, "").match(NUMBER) ?? []).map(normalizeNumber);
}

export type GuardResult = { ok: boolean; unverified: string[] };

// `facts` são os números confirmados (como número ou texto) entregues ao modelo, inclusive partes de datas.
export function verifyNumbers(text: string, facts: Array<number | string>): GuardResult {
  const allowed = new Set<string>();
  for (const fact of facts) {
    const raw = typeof fact === "number" ? String(fact) : fact;
    for (const token of raw.match(/\d+(?:[.,]\d+)*/g) ?? []) allowed.add(normalizeNumber(token));
  }
  const unverified = [...new Set(extractNumbers(text).filter((value) => !allowed.has(value)))];
  return { ok: unverified.length === 0, unverified };
}
