import { jsPDF } from "jspdf";
import { formatAnalyticsValue } from "@/modules/client-portal/analytics-charts";
import type { AnalyticsDashboardData, AnalyticsMetric } from "@/modules/client-portal/analytics-types";
import type { AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";
import { getSavedReportDocument } from "@/modules/client-portal/report-actions";

export type DashboardPdfInput = {
  title: string; clientName: string; workspaceName: string; headerDetails: string;
  data: AnalyticsDashboardData; metrics: AnalyticsMetric[]; entityLabels: string[]; accountLabels: string[];
  comparison: boolean; chartType: "line" | "bar";
  entityRows?: AnalyticsEntity[]; campaignMetrics?: AnalyticsMetric[];
};

export function buildDashboardPdf(input: DashboardPdfInput) {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const colors = { ink: "#142137", muted: "#65748b", blue: "#2563eb", paper: "#f4f7fc", border: "#dce4f0" };
  let y = 18;
  const line = (text: string, size = 10, color = colors.ink) => {
    doc.setFontSize(size); doc.setTextColor(color);
    const lines: string[] = doc.splitTextToSize(text.replace(/[\u2013\u2014]/g, "-"), 174);
    for (const row of lines) { ensure(6); doc.text(row, 18, y); y += size * .45 + 1; }
  };
  const pageHeader = () => {
    doc.setFillColor(colors.blue); doc.rect(0, 0, 210, 3, "F");
    doc.setFont("helvetica", "bold"); line(input.workspaceName, 14);
    doc.setFont("helvetica", "normal");
    if (input.headerDetails) line(input.headerDetails, 9, colors.muted);
    y += 8;
  };
  const ensure = (height: number) => { if (y + height > 278) { doc.addPage(); y = 18; pageHeader(); } };
  pageHeader();
  doc.setFont("helvetica", "bold"); line(input.title, 23); line(input.clientName, 14);
  doc.setFont("helvetica", "normal");
  line(`${input.data.dateFrom} a ${input.data.dateTo}  |  Meta Ads  |  ${input.data.currency ?? "Moedas por conta"}`, 10, colors.muted);
  line(`Contas: ${input.accountLabels.join("; ")}`, 9, colors.muted);
  const zones = [...new Set(input.data.accounts.filter(a => input.data.selectedAccountIds.includes(a.id)).map(a => a.timezoneName))];
  line(`Fusos: ${zones.join("; ")}  |  Comparação: ${input.comparison ? "período anterior" : "desativada"}  |  Gráfico: ${input.chartType === "bar" ? "barras" : "linhas"}`, 9, colors.muted);
  line(`Cobertura: ${input.data.coverage.coveredDays}/${input.data.coverage.totalDays} dias  |  Última coleta: ${input.data.coverage.latestCollectedAt ?? "indisponível"}`, 9, colors.muted);
  y += 5;
  for (let index = 0; index < input.metrics.length; index += 3) {
    ensure(31);
    input.metrics.slice(index, index + 3).forEach((metric, column) => {
      const x = 18 + column * 59;
      doc.setFillColor(colors.paper); doc.setDrawColor(colors.border); doc.roundedRect(x, y, 56, 27, 2, 2, "FD");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(colors.muted);
      const label: string[] = doc.splitTextToSize(metric.label, 49); doc.text(label.slice(0, 2), x + 4, y + 6);
      const value = formatAnalyticsValue(input.data.summary[metric.key], metric, input.data.currency);
      doc.setFont("helvetica", "bold"); doc.setFontSize(value.length > 18 ? 10 : 15); doc.setTextColor(colors.ink);
      doc.text(value, x + 4, y + 20);
    });
    y += 31;
  }
  for (const key of ["spend", "primary_results"]) {
    const metric = input.metrics.find(m => m.key === key);
    if (!metric) continue;
    ensure(64); y += 3;
    doc.setFont("helvetica", "bold"); line(`Evolução diária - ${metric.label}`, 12);
    const top = y; const height = 38; const width = 170;
    const current = input.data.daily.map(day => day.values[key]);
    const previous = input.data.previousDaily.map(day => day.values[key]);
    const max = Math.max(1, ...current.map(v => v ?? 0), ...(input.comparison ? previous.map(v => v ?? 0) : []));
    doc.setDrawColor(colors.border); doc.line(20, top + height, 190, top + height);
    const plot = (values: Array<number | null>, color: string, bars: boolean) => {
      doc.setDrawColor(color); doc.setFillColor(color); doc.setLineWidth(.6);
      values.forEach((value, i) => {
        if (value == null) return;
        const x = 20 + i * width / Math.max(1, values.length - 1);
        const py = top + height - value / max * height;
        if (bars) { const bw = width / Math.max(1, values.length); doc.rect(20 + i * bw, py, Math.max(.3, bw * .7), top + height - py, "F"); }
        else if (i > 0 && values[i - 1] != null) doc.line(20 + (i - 1) * width / Math.max(1, values.length - 1), top + height - (values[i - 1] ?? 0) / max * height, x, py);
        else doc.circle(x, py, .6, "F");
      });
    };
    if (input.comparison) plot(previous, "#a5b4fc", false);
    plot(current, colors.blue, input.chartType === "bar");
    y = top + height + 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(colors.muted);
    doc.text(input.data.dateFrom, 20, y); doc.text(input.data.dateTo, 190, y, { align: "right" }); y += 5;
    if (input.comparison) line("Azul: período atual. Lilás: período anterior. Dias sem cobertura não recebem zero.", 8, colors.muted);
    y += 4;
  }
  doc.setFont("helvetica", "bold"); line("Seleção da análise", 12); doc.setFont("helvetica", "normal");
  input.entityLabels.forEach(label => line(`- ${label}`, 9));
  const columns = input.campaignMetrics ?? [];
  for (let offset = 0; offset < columns.length && input.entityRows?.length; offset += 3) {
    const group = columns.slice(offset, offset + 3);
    y += 6; ensure(26); doc.setFont("helvetica", "bold"); line("Desempenho da seleção - Meta Ads", 12);
    const tableHeader = () => {
      ensure(15); doc.setFillColor(colors.paper); doc.rect(18, y, 174, 13, "F");
      doc.setFontSize(8); doc.setTextColor(colors.ink); doc.setFont("helvetica", "bold");
      doc.text("Campanha / conjunto / anúncio", 20, y + 5);
      group.forEach((metric, i) => doc.text(doc.splitTextToSize(metric.label, 34).slice(0, 2), 80 + i * 37, y + 5));
      y += 16;
    };
    tableHeader();
    for (const entity of input.entityRows) {
      const name: string[] = doc.splitTextToSize(entity.name, 54);
      const rowHeight = Math.max(11, name.length * 4 + 4);
      if (y + rowHeight > 278) { ensure(rowHeight); tableHeader(); }
      doc.setFont("helvetica", "normal"); doc.setTextColor(colors.ink); doc.setFontSize(8);
      doc.text(name, 20, y + 3);
      group.forEach((metric, i) => doc.text(formatAnalyticsValue(entity.values[metric.key], metric, entity.currency), 80 + i * 37, y + 3));
      doc.setDrawColor(colors.border); doc.line(18, y + rowHeight - 3, 192, y + rowHeight - 3); y += rowHeight;
    }
  }
  if (input.data.summary.reach == null) { y += 3; line("Alcance, frequência e cliques únicos não são somados entre entidades. Campos sem deduplicação exata ficam indisponíveis.", 8, colors.muted); }
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page); doc.setFontSize(8); doc.setTextColor(colors.muted);
    doc.text(`iGrow Reports  |  ${page} / ${total}`, 18, 290);
  }
  return doc;
}

export async function downloadDashboardPdf(input: DashboardPdfInput) {
  const safeName = input.clientName.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80);
  buildDashboardPdf(input).save(`${safeName}-${input.data.dateFrom}-${input.data.dateTo}.pdf`);
}

export async function downloadSavedReportPdf(clientId: string, versionId: string) {
  const result = await getSavedReportDocument({ clientId, versionId });
  if ("error" in result) throw new Error(result.error);
  await downloadDashboardPdf(result.document);
}
