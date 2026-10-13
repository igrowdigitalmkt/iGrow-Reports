import "server-only";

import { getClientAccountBilling, getClientAudienceBreakdowns } from "@/modules/meta/server";
import { audienceForPdf, balancesForPdf } from "./extras-map";
import type { ReportPdfInput } from "./types";

// Público e saldo ainda não são congelados no relatório salvo. Quando o PDF novo está ligado, são lidos da Meta
// na hora de gerar. Falha aqui nunca derruba o PDF: o bloco só deixa de aparecer.
export async function loadReportPdfExtras(input: { agencyId: string; clientId: string; dateFrom: string; dateTo: string; accountIds: string[]; includeBalances: boolean }): Promise<Pick<ReportPdfInput, "audience" | "balances">> {
  const [audience, balances] = await Promise.all([
    getClientAudienceBreakdowns({ agencyId: input.agencyId, clientId: input.clientId, since: input.dateFrom, until: input.dateTo, accountIds: input.accountIds })
      .then(audienceForPdf).catch(() => undefined),
    // Saldo e forma de pagamento são informações internas: só entram no PDF aberto por quem é da equipe, nunca pela Área do Cliente.
    input.includeBalances ? getClientAccountBilling({ agencyId: input.agencyId, clientId: input.clientId }).then(balancesForPdf).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  return { audience, balances };
}
