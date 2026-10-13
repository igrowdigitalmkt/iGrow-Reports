import type { DashboardPdfInput } from "../pdf-download";
import type { ReportPdfInput } from "./types";

// Chave global opcional NEXT_PUBLIC_REPORT_PDF_V2=1 (liga para todas as organizações). O normal é cada organização escolher o layout em Configurações.
// A apresentação horizontal continua no gerador antigo, que tem outro objetivo.
export function isReportPdfV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_REPORT_PDF_V2 === "1";
}

// O layout novo vale para PDFs verticais quando a organização o escolheu (Configurações) ou quando a chave global está ligada.
export function usesReportPdfV2(input: Pick<DashboardPdfInput, "orientation" | "layout">): boolean {
  return input.orientation !== "horizontal" && (input.layout === "modern" || isReportPdfV2Enabled());
}

export function toReportPdfInput(input: DashboardPdfInput): ReportPdfInput {
  // Relatório de uma conta de um cliente com várias: o nome da conta aparece no cabeçalho (o cliente pode ter o mesmo nome da conta).
  const only = input.data.selectedAccountIds.length === 1 && input.data.accounts.length > 1
    ? input.data.accounts.find(account => account.id === input.data.selectedAccountIds[0]) : undefined;
  return {
    accountLabel: only?.name,
    clientName: input.clientName, workspaceName: input.workspaceName, analysisNote: input.analysisNote,
    data: input.data, entityRows: input.entityRows, audience: input.audience, balances: input.balances,
  };
}
