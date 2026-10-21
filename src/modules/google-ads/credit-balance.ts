import { z } from "zod";

/**
 * Saldo ESTIMADO de uma conta do Google Ads com crédito informado manualmente. A API do Google não informa o crédito de pagamentos
 * manuais (Pix, boleto, pré-pago); por isso a plataforma guarda o que o usuário depositou e desconta o gasto lido da API desde o
 * primeiro depósito. É uma estimativa: não inclui impostos, ajustes nem créditos que o Google aplique por conta própria.
 */
export type CreditEntry = { id: string; amount: number; currency: string; depositedOn: string; note: string | null; createdAt: string };

export type CreditEstimate = {
  currency: string;
  /** Soma dos créditos informados (ainda não removidos). */
  informed: number;
  /** Primeiro dia coberto pelos créditos (o gasto conta a partir daqui). */
  since: string;
  /** Gasto da conta lido na API desde `since`. */
  spentSince: number;
  /** informed − spentSince, nunca abaixo de zero. */
  estimatedBalance: number;
  /** O gasto já passou do que foi informado: ou faltou informar um depósito, ou o crédito acabou. */
  exceeded: boolean;
  entries: CreditEntry[];
};

export function estimateCredit(entries: CreditEntry[], spentSince: number): CreditEstimate | null {
  if (!entries.length || !Number.isFinite(spentSince) || spentSince < 0) return null;
  const currencies = new Set(entries.map(entry => entry.currency));
  // Moedas diferentes não se somam; a conta tem uma moeda só, então isto só acontece com dado inconsistente.
  if (currencies.size !== 1) return null;
  const informed = Math.round(entries.reduce((total, entry) => total + entry.amount, 0) * 100) / 100;
  const since = entries.map(entry => entry.depositedOn).sort()[0]!;
  const spent = Math.round(spentSince * 100) / 100;
  return { currency: [...currencies][0]!, informed, since, spentSince: spent, estimatedBalance: Math.max(0, Math.round((informed - spent) * 100) / 100), exceeded: spent > informed, entries };
}

/** Dados do formulário de crédito, validados no servidor antes de gravar. */
export const creditInputSchema = z.object({
  clientId: z.uuid(), accountId: z.uuid(),
  amount: z.number().positive().max(100_000_000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Use no máximo duas casas decimais."),
  depositedOn: z.iso.date(),
  note: z.string().trim().max(200).optional(),
});
export const creditRemoveSchema = z.object({ clientId: z.uuid(), creditId: z.uuid() });
