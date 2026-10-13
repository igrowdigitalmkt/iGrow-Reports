import { Font, pdf } from "@react-pdf/renderer";
import { confirmedReportData } from "../report-presentation";
import { buildReportFacts } from "../report-facts";
import { ReportDocument } from "./document";
import { INTER_BOLD, INTER_MEDIUM, INTER_REGULAR } from "./inter-fonts";
import type { ReportPdfInput } from "./types";

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  Font.register({ family: "Inter", fonts: [
    { src: INTER_REGULAR, fontWeight: 400 }, { src: INTER_MEDIUM, fontWeight: 500 }, { src: INTER_BOLD, fontWeight: 700 },
  ] });
  // Nunca hifenizar: nomes de campanha e valores não podem ser partidos no meio.
  Font.registerHyphenationCallback(word => [word]);
  fontsRegistered = true;
}

export class ReportPdfUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "ReportPdfUnavailableError"; }
}

// PDF do relatório novo, com uma seção por conta de anúncios (uma só seção = relatório comum).
// Funciona no servidor e no navegador. Só gera com cobertura completa do período em todas as seções.
export async function renderReportPdfSections(originals: ReportPdfInput[]): Promise<Blob> {
  if (!originals.length) throw new ReportPdfUnavailableError("Nenhuma conta para o relatório.");
  const sections = originals.map(original => {
    const input: ReportPdfInput = { ...original, data: confirmedReportData(original.data) };
    if (input.data.coverage.status !== "complete") {
      throw new ReportPdfUnavailableError("Relatórios exigem cobertura completa do período.");
    }
    return { input, facts: buildReportFacts(input.data, input.entityRows) };
  });
  registerFonts();
  return pdf(<ReportDocument sections={sections} />).toBlob();
}

export function renderReportPdf(original: ReportPdfInput): Promise<Blob> {
  return renderReportPdfSections([original]);
}
