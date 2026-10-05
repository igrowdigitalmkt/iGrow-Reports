import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { buildMetaSnapshotPdf, buildMetaSnapshotPdfAsync, loadSnapshotPdfFonts } from "@/modules/reports/snapshot-pdf";
import { SnapshotPdfUnsupportedTextError } from "@/modules/reports/snapshot-pdf-error";
import { snapshotPdfFixture } from "./fixtures/snapshot-pdf";
const fonts = { regular: readFileSync("public/fonts/NotoSans-Regular.ttf").toString("base64"), bold: readFileSync("public/fonts/NotoSans-Bold.ttf").toString("base64") };
mkdirSync("artifacts/snapshot-pdf", { recursive: true });
const input = (count = 3) => ({ view: snapshotPdfFixture(count), externalAccountId: "act_123", level: "ad" as const, accountName: "Conta demonstrativa - iGrow" });
afterEach(() => { vi.unstubAllGlobals(); });
it("exports the confirmed previous period and blocks an incomplete comparison", () => {
  const source = input(1); const previousView = structuredClone(source.view);
  for (const scope of previousView.scopes) {
    scope.identity.dateFrom = "2026-09-28"; scope.identity.dateTo = "2026-09-30";
    scope.snapshotId = "previous-confirmed-snapshot";
  }
  const report = buildMetaSnapshotPdf({ ...source,previousView },fonts);
  expect(report.filename).toContain("comparacao.pdf");
  writeFileSync("artifacts/snapshot-pdf/comparison.pdf",Buffer.from(report.doc.output("arraybuffer")));
  previousView.status = "pending";
  expect(() => buildMetaSnapshotPdf({ ...source,previousView },fonts)).toThrow();
});
it("creates a real PDF with the authorized scope and leaves source values untouched", () => {
  const source = input(); const before = JSON.stringify(source);
  const report = buildMetaSnapshotPdf(source, fonts);
  expect(report.filename).toBe("meta-act_123-ad-2026-10-01-2026-10-03.pdf");
  expect(report.entityCount).toBe(3); expect(report.doc.getNumberOfPages()).toBeGreaterThan(1);
  expect(Buffer.from(report.doc.output("arraybuffer")).subarray(0, 5).toString()).toBe("%PDF-");
  expect(JSON.stringify(source)).toBe(before);
  mkdirSync("artifacts/snapshot-pdf", { recursive: true });
  writeFileSync("artifacts/snapshot-pdf/sample.pdf", Buffer.from(report.doc.output("arraybuffer")));
});
it("exports all 61 entities, independently of UI search and pagination", () => {
  const report = buildMetaSnapshotPdf(input(61), fonts);
  expect(report.entityCount).toBe(61); expect(report.doc.getNumberOfPages()).toBeGreaterThan(20);
  writeFileSync("artifacts/snapshot-pdf/large.pdf", Buffer.from(report.doc.output("arraybuffer")));
});
it.each(["pending", "missing", "duplicate", "other-account", "other-level", "other-provider"])("blocks unconfirmed scope: %s", kind => {
  const source = input();
  if (kind === "pending") source.view.status = "pending";
  if (kind === "missing") source.view.missing = [source.view.scopes[0].identity];
  if (kind === "duplicate") source.view.scopes.push(source.view.scopes[0]);
  if (kind === "other-account") source.externalAccountId = "act_999";
  if (kind === "other-level") source.view.scopes[0].identity.level = "campaign";
  if (kind === "other-provider") source.view.scopes[0].identity.provider = "google";
  expect(() => buildMetaSnapshotPdf(source, fonts)).toThrow();
});
it("records a stale confirmation and a confirmed empty scope", () => {
  const source = input(0); source.view.status = "stale";
  const report = buildMetaSnapshotPdf(source, fonts);
  expect(report.entityCount).toBe(0); expect(report.doc.getNumberOfPages()).toBe(1);
  writeFileSync("artifacts/snapshot-pdf/empty-stale.pdf", Buffer.from(report.doc.output("arraybuffer")));
});
it("splits oversized names and rows rather than clipping them", () => {
  const source = input(1);
  source.view.scopes[0].entities[0].name = "Nome extenso com acentuação e detalhes. ".repeat(180);
  source.view.scopes[0].entities[0].indicators[0].label = "Indicador extenso com unidade. ".repeat(120);
  const report = buildMetaSnapshotPdf(source, fonts);
  expect(report.doc.getNumberOfPages()).toBeGreaterThan(2);
  writeFileSync("artifacts/snapshot-pdf/oversized.pdf", Buffer.from(report.doc.output("arraybuffer")));
});
it("preserves supported Unicode and rejects unsupported glyphs explicitly", () => {
  const source = input(1); source.view.scopes[0].entities[0].name = "Ação café e verão - Καμπάνια - Кампания";
  const report = buildMetaSnapshotPdf(source, fonts);
  writeFileSync("artifacts/snapshot-pdf/unicode.pdf", Buffer.from(report.doc.output("arraybuffer")));
  source.view.scopes[0].entities[0].name = "Anúncio 🚀";
  expect(() => buildMetaSnapshotPdf(source, fonts)).toThrow(SnapshotPdfUnsupportedTextError);
});
it("does not mix another account or level into the PDF", () => {
  const source = input(1); const other = structuredClone(source.view.scopes[0]);
  other.identity.externalAccountId = "act_999"; other.entities[0].name = "CONTA QUE NÃO DEVE APARECER";
  source.view.scopes.push(other);
  const parent = structuredClone(other); parent.identity.externalAccountId = "act_123"; parent.identity.level = "campaign";
  parent.entities[0].name = "NÍVEL QUE NÃO DEVE APARECER"; source.view.scopes.push(parent);
  const report = buildMetaSnapshotPdf(source, fonts); expect(report.entityCount).toBe(1);
  writeFileSync("artifacts/snapshot-pdf/isolated.pdf", Buffer.from(report.doc.output("arraybuffer")));
});
it("yields while generating large reports and reports completion accurately", async () => {
  const timer = vi.fn(); setTimeout(timer, 0);
  const progress = vi.fn(); const report = await buildMetaSnapshotPdfAsync(input(16), fonts, progress);
  expect(timer).toHaveBeenCalledOnce(); expect(progress).toHaveBeenCalledTimes(16);
  expect(progress).toHaveBeenLastCalledWith(16, 16); expect(report.entityCount).toBe(16);
});
it("cancels generation between entities without preparing a partial PDF", async () => {
  const controller = new AbortController(); const progress = vi.fn((completed: number) => { if (completed === 6) controller.abort(); });
  await expect(buildMetaSnapshotPdfAsync(input(61), fonts, progress, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(progress).toHaveBeenCalledTimes(6);
});
it("refuses an already cancelled operation before font parsing or validation", async () => {
  const controller = new AbortController(); controller.abort(); const progress = vi.fn();
  await expect(buildMetaSnapshotPdfAsync(input(), { regular: "invalid", bold: "invalid" }, progress, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(progress).not.toHaveBeenCalled();
});
it("retries a font download failure and caches only successful same-origin loads", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher); await expect(loadSnapshotPdfFonts()).rejects.toThrow("fonte");
  fetcher.mockImplementation(() => Promise.resolve(new Response(new Uint8Array([0, 1, 2]))));
  await expect(loadSnapshotPdfFonts()).resolves.toEqual({ regular: "AAEC", bold: "AAEC" });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/fonts/NotoSans-Regular.ttf", "/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf", "/fonts/NotoSans-Bold.ttf"]);
  await loadSnapshotPdfFonts(); expect(fetcher).toHaveBeenCalledTimes(4);
});
