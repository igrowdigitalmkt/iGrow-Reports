// Créditos de IA: a unidade que o assinante enxerga. O custo real continua medido e limitado em dólar (ai_usage, planos, orçamento);
// só a exibição converte. Para mudar a escala, altere apenas AI_CREDITS_PER_USD.
export const AI_CREDITS_PER_USD = 2000;

export const usdToCredits = (usd: number) => Math.round(Math.max(0, usd) * AI_CREDITS_PER_USD);
export const creditsToUsd = (credits: number) => Math.round((Math.max(0, credits) / AI_CREDITS_PER_USD) * 1e6) / 1e6;
export const formatCredits = (credits: number) => Math.round(credits).toLocaleString("pt-BR");

export type AiCreditsView = {
  limit: number; used: number; remaining: number;
  /** 0 a 100, inteiro; 100 quando não há limite disponível. */
  percent: number;
  level: "ok" | "warning" | "exhausted";
  /** Próxima renovação (início do mês seguinte, UTC), como AAAA-MM-DD. */
  resetsOn: string;
};

export function aiCreditsView({ budgetUsd, costUsd, now = new Date() }: { budgetUsd: number; costUsd: number; now?: Date }): AiCreditsView {
  const limit = usdToCredits(budgetUsd);
  const used = usdToCredits(costUsd);
  const percent = limit > 0 ? Math.min(100, Math.floor((used / limit) * 100)) : 100;
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    limit, used: Math.min(used, limit), remaining: Math.max(0, limit - used), percent,
    level: limit === 0 || used >= limit ? "exhausted" : percent >= 80 ? "warning" : "ok",
    resetsOn: reset.toISOString().slice(0, 10),
  };
}
