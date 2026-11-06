/**
 * Porta de entrada dos PDFs para telas do navegador: o gerador (jsPDF e o layout dos relatórios) só é baixado quando a pessoa pede o PDF,
 * em vez de ir junto com o pacote de toda tela que tem um botão de baixar. O código do servidor e os testes continuam usando `pdf-download`.
 */
type Pdf = typeof import("./pdf-download");

export type { DashboardPdfInput } from "./pdf-download";

export const downloadCombinedPdf = async (...args: Parameters<Pdf["downloadCombinedPdf"]>) => (await import("./pdf-download")).downloadCombinedPdf(...args);
export const downloadCombinedSavedReports = async (...args: Parameters<Pdf["downloadCombinedSavedReports"]>) => (await import("./pdf-download")).downloadCombinedSavedReports(...args);
export const downloadDashboardPdf = async (...args: Parameters<Pdf["downloadDashboardPdf"]>) => (await import("./pdf-download")).downloadDashboardPdf(...args);
export const downloadSavedReportPdf = async (...args: Parameters<Pdf["downloadSavedReportPdf"]>) => (await import("./pdf-download")).downloadSavedReportPdf(...args);
export const buildSavedReportPdfFile = async (...args: Parameters<Pdf["buildSavedReportPdfFile"]>) => (await import("./pdf-download")).buildSavedReportPdfFile(...args);
