import { jsPDF } from "jspdf";
import type { EntityLevel } from "../integrations/data-contract";
import type { MetaSnapshotView, MetaSnapshotIndicator } from "../meta/snapshot-view";
import { confirmedMetaSnapshotScope } from "../meta/snapshot-export";
import { SnapshotPdfUnsupportedTextError } from "./snapshot-pdf-error";

export type SnapshotPdfFonts = { regular: string; bold: string };
export type SnapshotPdfInput = { view: MetaSnapshotView; externalAccountId: string; level: EntityLevel; accountName: string };
const levels: Record<EntityLevel, string> = { account: "Conta", campaign: "Campanhas", adset: "Conjuntos", ad: "Anúncios" };
const states = { available: "Confirmado", zero: "Zero confirmado", unavailable: "Indisponível", error: "Não confirmado" };
const units: Record<string, string> = { currency: "Moeda", count: "Contagem", percent: "Percentual", ratio: "Taxa" };
const colors = { ink: "#182b40", muted: "#596c7f", teal: "#087f8c", line: "#dbe5ea", paper: "#f1f6f8", amber: "#8a5700" };

// Values stay strings throughout: PDF generation never aggregates or rounds.
function* snapshotPdfSteps(input: SnapshotPdfInput, fonts: SnapshotPdfFonts) {
  const scope = confirmedMetaSnapshotScope(input.view, input.externalAccountId, input.level);
  const doc = new jsPDF({ format: "a4", unit: "mm", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS("NotoSans-Regular.ttf", fonts.regular); doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", fonts.bold); doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
  doc.setFont("NotoSans", "normal");
  const font = doc.getFont().metadata as { characterToGlyph?: (code: number) => number };
  if (typeof font.characterToGlyph !== "function") throw Error("Não foi possível carregar a fonte do relatório.");
  const clean = (value: string) => {
    const text = value.normalize("NFC").replace(/[\u2010-\u2015]/g, "-").replace(/\t/g, " ").replace(/\r\n?/g, "\n");
    for (const char of text) {
      if (char !== "\n" && (!font.characterToGlyph!(char.codePointAt(0)!) || char.length > 1)) {
        throw new SnapshotPdfUnsupportedTextError();
      }
    }
    return text;
  };
  const left = 18, width = 174, bottom = 276, lineHeight = 4.5;
  let y = 24;
  const style = (size = 9, bold = false, color = colors.ink) => {
    doc.setFont("NotoSans", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color);
  };
  const header = () => {
    doc.setFillColor(colors.teal); doc.rect(0, 0, 210, 3, "F");
    style(8, true, colors.teal); doc.text("iGrow Reports", left, 13);
    style(8, false, colors.muted); doc.text(`Meta Ads | ${levels[input.level]}`, 192, 13, { align: "right" });
  };
  const newPage = () => { doc.addPage(); y = 24; header(); };
  const ensure = (height: number) => { if (y + height > bottom) newPage(); };
  const lines = (value: string, columnWidth: number, size = 9, bold = false) => {
    style(size, bold);
    return doc.splitTextToSize(clean(value), columnWidth) as string[];
  };
  const text = (value: string, size = 9, bold = false, color = colors.ink) => {
    const wrapped = lines(value, width, size, bold);
    const height = Math.max(lineHeight, size * 0.48);
    for (const line of wrapped) {
      ensure(height); style(size, bold, color); doc.text(line, left, y); y += height;
    }
    y += 3;
  };
  const tableHeader = () => {
    ensure(20); doc.setFillColor(colors.paper); doc.rect(left, y, width, 10, "F"); style(8, true, colors.muted);
    doc.text("Indicador / unidade", left + 3, y + 6); doc.text("Valor exato", left + 81, y + 6); doc.text("Disponibilidade", left + 141, y + 6); y += 10;
  };
  const continuedTable = (entityIndex: number) => {
    newPage(); text(`Entidade ${entityIndex + 1} - indicadores (continuação)`, 8, true, colors.muted); tableHeader();
  };
  const row = (cells: string[], alternate: boolean, entityIndex: number) => {
    const widths = [78, 60, 36]; const wrapped = cells.map((cell, index) => lines(cell, widths[index] - 6, 8));
    let offset = 0; const total = Math.max(...wrapped.map(cell => cell.length), 1);
    // Split even a single oversized row across pages; repeat its table header.
    while (offset < total) {
      if (bottom - y < 13) continuedTable(entityIndex);
      const count = Math.min(total - offset, Math.max(1, Math.floor((bottom - y - 8) / lineHeight)));
      const height = count * lineHeight + 8;
      if (alternate) { doc.setFillColor("#fafcfd"); doc.rect(left, y, width, height, "F"); }
      style(8); let x = left;
      wrapped.forEach((cell, index) => {
        const fragment = cell.slice(offset, offset + count);
        if (fragment.length) doc.text(fragment, x + 3, y + 5, { lineHeightFactor: lineHeight / (8 * 25.4 / 72) });
        x += widths[index];
      });
      doc.setDrawColor(colors.line); doc.line(left, y + height, left + width, y + height);
      y += height; offset += count;
      if (offset < total) continuedTable(entityIndex);
    }
  };
  const value = (indicator: MetaSnapshotIndicator, currency: string | null) => {
    if (indicator.state === "error") return "Não confirmado";
    if (indicator.state === "unavailable" || indicator.value === null) return "Indisponível";
    return (indicator.unit === "currency" && currency ? `${currency} ` : "") + indicator.value + (indicator.unit === "percent" ? "%" : "");
  };
  header(); doc.setProperties({ title: "Análise confirmada - Meta Ads", subject: "Relatório de snapshots confirmados", author: "iGrow Reports" });
  text("Análise confirmada", 22, true);
  text(input.accountName, 14, true);
  const date = (iso: string) => iso.split("-").reverse().join("/");
  text(`${input.externalAccountId} | ${date(scope.identity.dateFrom)} a ${date(scope.identity.dateTo)}`, 9, false, colors.muted);
  text(`${levels[input.level]} | ${scope.entities.length} ${scope.entities.length === 1 ? "entidade" : "entidades"} | Todas as entidades do nível selecionado`, 9, false, colors.muted);
  text(input.view.status === "stale" ? "Dados confirmados anteriormente. Aguardando atualização." : "Dados confirmados para o período selecionado.", 10, true, input.view.status === "stale" ? colors.amber : colors.teal);
  text(`Coleta original: ${scope.collectedAt}`, 8, false, colors.muted);
  text("Valores decimais preservados, sem arredondamento. Indicadores indisponíveis não representam zero. Busca e paginação da tela não limitam este relatório.", 9, false, colors.muted);
  y += 4;
  for (const [index, entity] of scope.entities.entries()) {
    const details = [`ID: ${entity.id} | Moeda: ${entity.currency ?? "Não informada"} | Fuso: ${entity.timezone}`];
    if (entity.hierarchy?.campaignId) details.push(`Campanha: ${entity.hierarchy.campaignId}`);
    if (entity.hierarchy?.adsetId) details.push(`Conjunto: ${entity.hierarchy.adsetId}`);
    const heading = `${index + 1}. ${entity.name}`;
    const introductionHeight = lines(heading, width, 12, true).length * 5.76 + 3
      + details.reduce((height, detail) => height + lines(detail, width, 8).length * lineHeight + 3, 0);
    ensure(Math.min(introductionHeight + 30, bottom - 24));
    text(heading, 12, true);
    details.forEach(detail => text(detail, 8, false, colors.muted));
    const indicators = entity.indicators.filter(indicator => indicator.key !== "result:provider_known");
    if (indicators.length) {
      if (bottom - y < 27) continuedTable(index);
      else tableHeader();
      indicators.forEach((indicator, metricIndex) => row([`${indicator.label}\n${units[indicator.unit] ?? indicator.unit}`, value(indicator, entity.currency), states[indicator.state]], metricIndex % 2 === 0, index));
    } else text("Nenhum indicador retornado para esta entidade.", 9, false, colors.muted);
    y += 8;
    yield { completed: index + 1, total: scope.entities.length };
  }
  if (!scope.entities.length) text("Coleta confirmada sem entidades neste nível e período.", 11);
  ensure(55); y += 4; text("Origem dos dados", 12, true);
  text(`Snapshot: ${scope.snapshotId}\nAPI: ${scope.identity.apiVersion} | Contrato: ${scope.identity.contractVersion}\nColeta original: ${scope.collectedAt}`, 8, false, colors.muted);
  text("Dados fornecidos pela Meta Ads. Este arquivo contém uma única conta e nível. Valores de contas, moedas ou níveis diferentes não foram somados. CSV e JSON estão disponíveis para importação dos dados.", 8, false, colors.muted);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); style(8, false, colors.muted); doc.text(`iGrow Reports | ${page} / ${pages}`, left, 290);
  }
  return { doc, entityCount: scope.entities.length, filename: `meta-${input.externalAccountId}-${input.level}-${scope.identity.dateFrom}-${scope.identity.dateTo}.pdf` };
}

export function buildMetaSnapshotPdf(input: SnapshotPdfInput, fonts: SnapshotPdfFonts) {
  const steps = snapshotPdfSteps(input, fonts);
  let result = steps.next();
  while (!result.done) result = steps.next();
  return result.value;
}

export async function buildMetaSnapshotPdfAsync(input: SnapshotPdfInput, fonts: SnapshotPdfFonts,
  onProgress?: (completed: number, total: number) => void, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const steps = snapshotPdfSteps(input, fonts);
  let result = steps.next();
  while (!result.done) {
    onProgress?.(result.value.completed, result.value.total);
    // Let controls and the progress label repaint during large exports.
    if (result.value.completed % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    signal?.throwIfAborted();
    result = steps.next();
  }
  return result.value;
}

let fontPromise: Promise<SnapshotPdfFonts> | undefined;
export function loadSnapshotPdfFonts() {
  if (!fontPromise) fontPromise = Promise.all(["Regular", "Bold"].map(async weight => {
    const response = await fetch(`/fonts/NotoSans-${weight}.ttf`);
    if (!response.ok) throw Error("Não foi possível carregar a fonte do relatório.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  })).then(([regular, bold]) => ({ regular, bold })).catch(error => { fontPromise = undefined; throw error; });
  return fontPromise;
}
