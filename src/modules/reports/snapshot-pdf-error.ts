export class SnapshotPdfUnsupportedTextError extends Error {
  constructor() { super("Este relatório contém caracteres que a fonte do PDF não suporta. Exporte CSV ou JSON para preservá-los."); }
}
