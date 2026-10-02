import { jsPDF } from "jspdf";
import type { DashboardPdfInput } from "./pdf-download";
import { formatAnalyticsValue } from "@/modules/client-portal/analytics-charts";
import { reportDate, reportUpdatedAt, resultDescription, estimatedMetric } from "./report-presentation";

const C = { background: "#0d1724", panel: "#152536", border: "#2b4055", ink: "#e5edf8", muted: "#97afc8", cyan: "#55d7eb", purple: "#948aee", gold: "#e4bf78" };
const accents = [C.cyan, C.purple, "#55c7a1", C.gold, "#df8ab6", "#7aa2ee"];

export function buildPresentationPdf(input: DashboardPdfInput) {
  const doc = new jsPDF({ orientation: "landscape", unit: "px", format: [1920, 1080], hotfixes: ["px_scaling"] });
  const text = (value: string, x: number, y: number, size = 24, color = C.ink, width = 1720, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size * .75); doc.setTextColor(color);
    const lines: string[] = doc.splitTextToSize(value.replace(/[\u2013\u2014]/g, "-"), width);
    doc.text(lines, x, y, { lineHeightFactor: 1.25 });
    return lines.length * size * 1.25;
  };
  const panel = (x: number, y: number, width: number, height: number) => {
    doc.setFillColor(C.panel); doc.setDrawColor(C.border); doc.setLineWidth(1); doc.roundedRect(x, y, width, height, 12, 12, "FD");
  };
  const valueSize = (value: string, width: number, preferred = 39) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(preferred * .75);
    return Math.min(preferred, preferred * width / Math.max(width, doc.getTextWidth(value)));
  };
  const background = () => { doc.setFillColor(C.background); doc.rect(0, 0, 1920, 1080, "F"); doc.setFillColor(C.cyan); doc.rect(0, 0, 1920, 5, "F"); };
  const slide = (title: string, kicker = "DESEMPENHO · META ADS") => {
    doc.addPage([1920, 1080], "landscape"); background();
    text(kicker, 80, 77, 18, C.cyan); text(title, 80, 139, 42, C.ink, 1720, true);
    text(`${input.clientName}  |  ${reportDate(input.data.dateFrom)} a ${reportDate(input.data.dateTo)}`, 80, 183, 21, C.muted);
  };
  background();
  text(input.workspaceName, 100, 130, 32, C.cyan, 1640, true);
  text(input.title, 100, 280, 66, C.ink, 1640, true);
  text(input.clientName, 100, 400, 48, C.ink, 1640, true);
  text(`${reportDate(input.data.dateFrom)} a ${reportDate(input.data.dateTo)} | Meta Ads`, 100, 478, 29, C.muted);
  panel(100, 540, 1720, 350);
  let headerY = 600;
  for (const row of [`Cobertura: ${input.data.coverage.coveredDays}/${input.data.coverage.totalDays} dias`,
    `Contas: ${input.accountLabels.join("; ")}`, `Última atualização: ${reportUpdatedAt(input.data)} (Brasília)`, input.headerDetails].filter(Boolean)) {
    headerY += text(row, 135, headerY, 26, C.muted, 1640) + 18;
  }
  text("Relatório de performance · Apresentação", 100, 967, 20, C.muted);

  for (let offset = 0; offset < input.metrics.length; offset += 12) {
    slide(offset ? "Indicadores da análise · continuação" : "Visão geral dos resultados");
    input.metrics.slice(offset, offset + 12).forEach((metric, i) => {
      const x = 80 + i % 6 * 296, y = 240 + Math.floor(i / 6) * 340;
      panel(x, y, 276, 305); doc.setDrawColor(accents[(i + offset) % 6]); doc.setLineWidth(3); doc.line(x + 12, y + 2, x + 264, y + 2);
      text(metric.label, x + 20, y + 42, 20, C.muted, 236);
      const value = formatAnalyticsValue(input.data.summary[metric.key], metric, input.data.currency);
      text(value, x + 20, y + 147, valueSize(value, 235), C.ink, 236, true);
      if (["primary_results", "cost_per_result"].includes(metric.key)) text(resultDescription(input.data), x + 20, y + 191, 17, C.muted, 236);
      else if (estimatedMetric(input.data, metric.key)) text("Estimado entre contas", x + 20, y + 191, 17, C.gold, 236);
      const values = input.data.daily.map(day => day.values[metric.key]);
      const max = Math.max(1, ...values.map(value => value ?? 0));
      doc.setDrawColor(accents[(i + offset) % 6]); doc.setLineWidth(2);
      values.forEach((value, index) => {
        const previous = values[index - 1];
        if (value == null || previous == null) return;
        doc.line(x + 20 + (index - 1) / Math.max(1, values.length - 1) * 236, y + 283 - previous / max * 48,
          x + 20 + index / Math.max(1, values.length - 1) * 236, y + 283 - value / max * 48);
      });
    });
    if (input.data.selectedAccountIds.length > 1) text("Estimativas entre contas podem incluir pessoas repetidas. Frequência = impressões / alcance estimado.", 80, 970, 18, C.gold);
  }

  slide("Evolução no tempo");
  for (const [index, key] of ["spend", "primary_results"].entries()) {
    const metric = input.data.metrics.find(metric => metric.key === key);
    if (!metric) continue;
    const x = 80 + index * 900; panel(x, 240, 860, 665);
    text(metric.label, x + 35, 298, 28, C.ink, 790, true);
    const current = input.data.daily.map(day => day.values[key]), previous = input.data.previousDaily.map(day => day.values[key]);
    const max = Math.max(1, ...current.map(value => value ?? 0), ...(input.comparison ? previous.map(value => value ?? 0) : []));
    const left = x + 120, top = 365, width = 690, height = 390;
    for (let tick = 0; tick <= 4; tick++) {
      const y = top + height - tick / 4 * height;
      doc.setDrawColor(C.border); doc.setLineWidth(1); doc.line(left, y, left + width, y);
      text(formatAnalyticsValue(max * tick / 4, metric, input.data.currency), x + 18, y + 5, 16, C.muted, 98);
    }
    const plot = (values: Array<number | null>, color: string, bars: boolean) => {
      doc.setDrawColor(color); doc.setFillColor(color); doc.setLineWidth(3);
      values.forEach((value, i) => {
        if (value == null) return;
        const px = left + i / Math.max(1, values.length - 1) * width, py = top + height - value / max * height;
        if (bars) { const barWidth = width / Math.max(1, values.length); doc.rect(left + i * barWidth, py, Math.max(1, barWidth * .7), value / max * height, "F"); }
        else if (i > 0 && values[i - 1] != null) doc.line(left + (i - 1) / Math.max(1, values.length - 1) * width, top + height - (values[i - 1] ?? 0) / max * height, px, py);
        else doc.circle(px, py, 3, "F");
      });
    };
    if (input.comparison) plot(previous, C.purple, false);
    plot(current, C.cyan, input.chartType === "bar");
    text(reportDate(input.data.dateFrom), left, 800, 18, C.muted);
    text(reportDate(input.data.dateTo), left + width - 132, 800, 18, C.muted);
    text(input.comparison ? "Ciano: atual · Lilás: anterior" : "Período atual", x + 35, 860, 18, C.muted);
  }
  text("Dias sem dados confirmados não são representados como zero.", 80, 970, 19, C.muted);

  slide("O que merece atenção", "LEITURA DOS DADOS");
  const campaigns = [...input.data.campaigns].sort((a, b) => (b.values.spend ?? 0) - (a.values.spend ?? 0));
  const spend = input.data.summary.spend ?? 0;
  const observations = [
    { title: "Resultado principal", body: `${formatAnalyticsValue(input.data.summary.primary_results, input.data.metrics.find(m => m.key === "primary_results")!, input.data.currency)} ${resultDescription(input.data)}. Custo por resultado: ${formatAnalyticsValue(input.data.summary.cost_per_result, input.data.metrics.find(m => m.key === "cost_per_result")!, input.data.currency)}.` },
    { title: "Concentração do investimento", body: campaigns[0] && spend ? `${campaigns[0].name} concentrou ${((campaigns[0].values.spend ?? 0) / spend * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do valor usado.` : "Sem investimento registrado para a seleção." },
    { title: "Resposta aos anúncios", body: `${(input.data.summary.link_clicks ?? 0).toLocaleString("pt-BR")} cliques no link em ${(input.data.summary.impressions ?? 0).toLocaleString("pt-BR")} impressões.` },
  ];
  observations.forEach((observation, i) => { panel(80, 245 + i * 215, 1760, 185); text(`0${i + 1}`, 110, 310 + i * 215, 28, C.cyan); text(observation.title, 185, 300 + i * 215, 28, C.ink, 1600, true); text(observation.body, 185, 350 + i * 215, 24, C.muted, 1590); });
  text("Observações descritivas calculadas sobre o escopo da análise.", 80, 970, 18, C.muted);

  if (input.data.accountTotals.length && input.entityLabels.includes("Todas as campanhas")) {
    const selectedAccounts = input.data.accountTotals.filter(account => input.data.selectedAccountIds.includes(account.id));
    for (let offset = 0; offset < selectedAccounts.length; offset += 8) {
      slide("Investimento por conta", "DISTRIBUIÇÃO");
      selectedAccounts.slice(offset, offset + 8).forEach((account, i) => {
        const y = 250 + i * 86, metric = input.data.metrics.find(m => m.key === "spend")!;
        text(account.name, 100, y, 24, C.ink, 540);
        doc.setFillColor(C.border); doc.roundedRect(650, y - 20, 900, 22, 6, 6, "F");
        doc.setFillColor(accents[i % 6]); const share = spend ? (account.values.spend ?? 0) / spend : 0;
        if (share > 0) doc.roundedRect(650, y - 20, Math.max(12, share * 900), 22, 6, 6, "F");
        text(formatAnalyticsValue(account.values.spend, metric, account.currency), 1590, y, 24, C.ink, 230);
      });
    }
  }
  const actions = input.data.metrics.filter(metric => metric.key.startsWith("action:") && input.data.summary[metric.key] != null);
  for (let offset = 0; offset < actions.length; offset += 12) {
    slide("Resultados em detalhe", "AÇÕES DA PLATAFORMA");
    actions.slice(offset, offset + 12).forEach((metric, i) => {
      const x = 80 + i % 3 * 596, y = 245 + Math.floor(i / 3) * 173;
      panel(x, y, 570, 150); text(metric.label, x + 24, y + 35, 19, C.muted, 518);
      text(formatAnalyticsValue(input.data.summary[metric.key], metric, input.data.currency), x + 24, y + 118, 32, C.ink, 518, true);
    });
    text("Tipos de ação podem se sobrepor; não são somados como uma conversão única.", 80, 970, 18, C.muted);
  }
  const rows = input.entityRows ?? [], columns = input.campaignMetrics?.length ? input.campaignMetrics : input.metrics.filter(m => ["spend", "reach", "impressions", "cpm"].includes(m.key));
  for (let group = 0; group < columns.length; group += 4) for (let offset = 0; offset < rows.length; offset += 8) {
    slide("Seleção incluída na análise", "DE ONDE VÊM OS RESULTADOS");
    const metrics = columns.slice(group, group + 4); panel(80, 240, 1760, 730);
    text("Campanha / conjunto / anúncio", 105, 295, 20, C.muted, 580);
    metrics.forEach((metric, i) => text(metric.label, 720 + i * 275, 285, 18, C.muted, 240));
    rows.slice(offset, offset + 8).forEach((row, i) => {
      const y = 367 + i * 76; text(row.name, 105, y, 19, C.ink, 570);
      metrics.forEach((metric, j) => text(formatAnalyticsValue(row.values[metric.key], metric, row.currency), 720 + j * 275, y, 23, C.ink, 240));
      doc.setDrawColor(C.border); doc.line(100, y + 34, 1820, y + 34);
    });
  }
  if (input.analysisNote?.trim()) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(24 * .75);
    const lines: string[] = doc.splitTextToSize(input.analysisNote.trim(), 1680);
    for (let offset = 0; offset < lines.length; offset += 22) {
      slide(offset ? "Comentários e próximos passos · continuação" : "Comentários e próximos passos");
      panel(80, 235, 1760, 720);
      lines.slice(offset, offset + 22).forEach((line, index) => text(line, 120, 285 + index * 29, 24, C.ink, 1680));
    }
  }
  doc.addPage([1920, 1080], "landscape"); background();
  text("Obrigado.", 100, 465, 100, C.ink, 1700, true);
  text(input.clientName, 105, 560, 40, C.muted);
  text(input.workspaceName, 105, 655, 32, C.cyan);
  text(`${reportDate(input.data.dateFrom)} a ${reportDate(input.data.dateTo)} | Meta Ads`, 105, 725, 26, C.muted);
  text("Os resultados apresentados respeitam as contas, o período e a seleção desta análise.", 105, 850, 24, C.muted, 1700);
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) { doc.setPage(page); text(`${input.workspaceName} · ${input.clientName}`, 80, 1030, 16, C.muted, 1470); text(`${page} / ${total}`, 1720, 1030, 16, C.muted, 150); }
  return doc;
}
