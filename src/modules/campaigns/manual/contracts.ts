/** Contratos compartilhados (servidor e cliente) das operações manuais de campanha. Sem segredos nem identificadores internos além dos da rota. */

export type ManualLevel = "campaign" | "adset";
export type ManualOp = "pause" | "resume" | "budget";
export type ManualRef = { clientId: string; accountId: string; level: ManualLevel; entityId: string };

export type OpAvailability = { enabled: boolean; reason?: string };

/** Estados do controle. Tudo que não é `ready` explica por que não há ação (e nenhum botão de escrita é oferecido). */
export type ManualControl =
  | {
    kind: "ready"; level: ManualLevel; entityId: string; accountName: string; currency: string; exponent: number;
    configuredStatus: "ACTIVE" | "PAUSED"; effectiveStatus: string | null;
    /** Orçamento diário atual CONFIRMADO na Meta, neste nível. null = não definido aqui (conjunto, compartilhado ou vitalício). */
    dailyBudgetMinor: number | null;
    /** Há outra operação não resolvida nesta conta (o banco permite uma por vez). */
    busy: boolean;
    ops: Record<ManualOp, OpAvailability>;
    checkedAt: string;
  }
  | { kind: "unauthorized" | "executor_disabled" | "account_disconnected" | "incompatible" | "unknown_state" | "unsupported_status"; message: string };

export type ManualRunFailureCode =
  | "invalid" | "unauthorized" | "executor_disabled" | "account_disconnected" | "incompatible" | "unknown_state" | "unsupported_status"
  | "busy" | "unavailable" | "stale" | "duplicate" | "blocked" | "failed";

export type ManualRunResult =
  | { ok: true; outcome: "verified" | "needs_verification"; message: string; control: ManualControl | null }
  | { ok: false; code: ManualRunFailureCode; message: string; control?: ManualControl | null };

export type ManualHistoryItem = {
  id: string; createdAt: string; action: string; origin: "manual" | "ai";
  requestedBy: "you" | "team" | "ai"; approved: boolean | null;
  status: string; failure: string | null;
  previousStatus: string | null; confirmedStatus: string | null;
  previousBudgetMinor: number | null; confirmedBudgetMinor: number | null; requestedBudgetMinor: number | null;
};

export const MANUAL_ACTION_NAMES = {
  pause: { campaign: "pause_campaign", adset: "pause_adset" },
  resume: { campaign: "resume_campaign", adset: "resume_adset" },
  budget: { campaign: "set_campaign_daily_budget", adset: "set_adset_daily_budget" },
} as const;

/** Aumento máximo aceito pelo executor no clique humano (em %). Mantido igual ao `MANUAL_MAX_INCREASE_PERCENT` da política. */
export const MANUAL_BUDGET_MAX_INCREASE_PERCENT = 1000;
export const MANUAL_BUDGET_MAX_MINOR = 1_000_000_000_000;

/** Casas decimais da moeda (a Meta guarda orçamentos na menor unidade da moeda). Moeda desconhecida => null (não permite editar). */
export function currencyExponent(currency: string): number | null {
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" && digits >= 0 && digits <= 3 ? digits : null;
  } catch { return null; }
}

export type BudgetParse = { ok: true; minor: number } | { ok: false; message: string };
/** Valor digitado no formato brasileiro ("1.234,56" ou "50") => unidade mínima, sem ponto flutuante. Casas além da moeda são recusadas. */
export function parseBudgetInput(text: string, exponent: number): BudgetParse {
  const raw = text.replace(/\s|R\$/g, "");
  if (!raw) return { ok: false, message: "Informe o novo orçamento diário." };
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(raw)) return { ok: false, message: "Use apenas números, com vírgula nas casas decimais (ex.: 150,00)." };
  const [whole = "", fraction = ""] = raw.replace(/\./g, "").split(",");
  if (fraction.length > exponent) return { ok: false, message: exponent === 0 ? "Esta moeda não usa casas decimais." : `Esta moeda aceita no máximo ${exponent} casas decimais.` };
  const minor = Number(whole + fraction.padEnd(exponent, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) return { ok: false, message: "O orçamento deve ser maior que zero." };
  if (minor > MANUAL_BUDGET_MAX_MINOR) return { ok: false, message: "Valor acima do limite aceito." };
  return { ok: true, minor };
}

export function formatMinor(minor: number, currency: string, exponent: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency, minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(minor / 10 ** exponent);
  } catch { return `${(minor / 10 ** exponent).toFixed(exponent)} ${currency}`; }
}

/** Validação do orçamento novo contra o atual confirmado (mesmas regras que o executor aplicará de novo no servidor). */
export function validateBudgetChange(current: number | null, next: number): { ok: true } | { ok: false; message: string } {
  if (current === null) return { ok: false, message: "O orçamento atual não está confirmado; não é possível alterar." };
  if (next === current) return { ok: false, message: "O novo orçamento é igual ao atual." };
  if (next > current && next * 100 > current * MANUAL_BUDGET_MAX_INCREASE_PERCENT) return { ok: false, message: "O aumento ultrapassa o limite de 1000% do orçamento atual." };
  return { ok: true };
}
