import type { DashboardPdfInput } from "../pdf-download";
import type { ReportPdfInput } from "./types";

// O PDF novo fica desligado até o responsável ativar NEXT_PUBLIC_REPORT_PDF_V2=1 (e publicar de novo).
// A apresentação horizontal continua no gerador antigo, que tem outro objetivo.
export function isReportPdfV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_REPORT_PDF_V2 === "1";
}

export function usesReportPdfV2(input: Pick<DashboardPdfInput, "orientation">): boolean {
  return isReportPdfV2Enabled() && input.orientation !== "horizontal";
}

export function toReportPdfInput(input: DashboardPdfInput): ReportPdfInput {
  return {
    clientName: input.clientName, workspaceName: input.workspaceName, analysisNote: input.analysisNote,
    data: input.data, entityRows: input.entityRows,
  };
}
