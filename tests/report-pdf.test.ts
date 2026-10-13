import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { writeFileSync } from "node:fs";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import { buildPeriodPdfV2 } from "@/modules/automations/period-pdf";
import { isReportPdfV2Enabled, toReportPdfInput, usesReportPdfV2 } from "@/modules/reports/pdf/adapter";
import { renderReportPdf, ReportPdfUnavailableError } from "@/modules/reports/pdf/render";
import { changeLabel, niceMax, summaryParts, toneFor } from "@/modules/reports/pdf/summary";
import { buildReportFacts } from "@/modules/reports/report-facts";
import type { ReportPdfInput } from "@/modules/reports/pdf/types";

const MESSAGES = "result:provider:action:onsite_conversion.messaging_conversation_started_7d";
const VISITS = "result:provider:instagram_profile_visits";
const ENGAGEMENT = "result:provider:action:post_engagement";
const days = (from: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${from}T12:00:00Z`) + i * 86400000).toISOString().slice(0, 10));

function data(overrides: Partial<AnalyticsDashboardData> = {}): AnalyticsDashboardData {
  return {
    dateFrom: "2026-09-12", dateTo: "2026-10-10", previousDateFrom: "2026-08-14", previousDateTo: "2026-09-11",
    currency: "BRL", timezoneName: "America/Sao_Paulo", primaryMetricKey: null, primaryActionType: null,
    accounts: [], selectedAccountIds: ["a", "b"],
    summary: { spend: 3649.69, impressions: 265590, reach: 128504, cpm: 13.74, link_clicks: 5000, "result:provider_known": 1, [MESSAGES]: 201, [VISITS]: 4162, [ENGAGEMENT]: 30583 },
    previousSummary: { spend: 4783.2, impressions: 314308, reach: 126480, cpm: 15.22, link_clicks: 4000, "result:provider_known": 1, [MESSAGES]: 180, [VISITS]: 5000, [ENGAGEMENT]: 20000 },
    daily: days("2026-09-12", 29).map((date, i) => ({ date, values: { spend: i === 5 ? null : 60 + ((i * 37) % 130), link_clicks: 80 + ((i * 53) % 200) } })),
    previousDaily: [],
    accountTotals: [
      { id: "a", name: "RM Imobiliária", currency: "BRL", values: { spend: 0 } },
      { id: "b", name: "Ronaldo Moreira", currency: "BRL", values: { spend: 3649.69 } },
    ],
    campaigns: [
      { id: "c1", name: "Campanha de mensagens com um nome bem longo para testar a quebra de linha no cartão", accountName: "Ronaldo Moreira", accountId: "b", currency: "BRL", status: null, values: { spend: 2613, "result:provider_known": 1, [MESSAGES]: 201 } },
      { id: "c2", name: "Perfil", accountName: "Ronaldo Moreira", accountId: "b", currency: "BRL", status: null, values: { spend: 707.54, "result:provider_known": 1, [VISITS]: 4162 } },
      { id: "c3", name: "Engajamento", accountName: "Ronaldo Moreira", accountId: "b", currency: "BRL", status: null, values: { spend: 329.15, "result:provider_known": 1, [ENGAGEMENT]: 30583 } },
    ],
    metrics: [],
    coverage: { status: "complete", previousStatus: "complete", latestCollectedAt: "2026-10-12T09:01:54Z", coveredDays: 29, previousCoveredDays: 29, totalDays: 29 },
    warnings: [],
    ...overrides,
  };
}

const input = (overrides: Partial<ReportPdfInput> = {}): ReportPdfInput => ({
  clientName: "Cliente de teste", workspaceName: "iGrow Digital", data: data(),
  analysisNote: "A campanha de mensagens concentra a maior parte do investimento. Vale acompanhar o custo por conversa nas próximas semanas.",
  audience: { indicator: "Alcance", groups: [
    { title: "Plataformas", total: "133 mil", items: [{ label: "Instagram", value: 86, display: "86 mil" }, { label: "WhatsApp", value: 30.6, display: "30,6 mil" }, { label: "Facebook", value: 16.3, display: "16,3 mil" }] },
    { title: "Região", total: "127,7 mil", items: [{ label: "Piauí", value: 113.9, display: "113,9 mil" }, { label: "Maranhão", value: 13.8, display: "13,8 mil" }] },
  ] },
  balances: [{ name: "Ronaldo Moreira", status: "Ativa · Pós-pago · VISA *7129", cells: [{ label: "A pagar", value: "R$ 940,70" }, { label: "Média por dia", value: "R$ 121,66" }, { label: "Limite de gastos", value: "Sem limite", sub: "R$ 28.736,37 gastos desde a criação" }] }],
  ...overrides,
});

const pageCount = (bytes: Buffer) => (bytes.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
async function render(value: ReportPdfInput) {
  const blob = await renderReportPdf(value);
  return Buffer.from(await blob.arrayBuffer());
}

describe("PDF novo do relatório", () => {
  it("gera um PDF válido com os blocos do desenho", async () => {
    const bytes = await render(input());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(bytes)).toBeGreaterThanOrEqual(3);
    expect(pageCount(bytes)).toBeLessThanOrEqual(8);
    if (process.env.IGROW_PDF_QA_DIR) writeFileSync(`${process.env.IGROW_PDF_QA_DIR}/report-v2.pdf`, bytes);
  });

  it("não gera sem cobertura completa do período", async () => {
    const partial = data({ coverage: { ...data().coverage, status: "partial" } });
    await expect(renderReportPdf(input({ data: partial }))).rejects.toBeInstanceOf(ReportPdfUnavailableError);
  });

  it("blocos desligados e dados ausentes encurtam o relatório sem quebrar", async () => {
    const full = pageCount(await render(input()));
    const short = pageCount(await render(input({ audience: undefined, balances: undefined, analysisNote: "", blocks: { campaigns: false, performance: false, accounts: false, delivery: false } })));
    expect(short).toBeLessThan(full);
    expect(short).toBeGreaterThanOrEqual(1);
  });

  it("aguenta sem resultados confirmados e sem série diária", async () => {
    const bare = data({ summary: { spend: 100, impressions: 1000, reach: 900, cpm: 100 }, previousSummary: {}, daily: [], campaigns: [], accountTotals: [] });
    expect(pageCount(await render(input({ data: bare, audience: undefined, balances: undefined })))).toBeGreaterThanOrEqual(1);
  });
});

describe("textos e escalas do PDF", () => {
  it("o resumo cita todos os tipos de resultado, cada um com o custo", () => {
    const text = summaryParts(buildReportFacts(data())).map(part => part.text).join("");
    expect(text).toContain("R$ 3.649,69");
    expect(text).toContain("201 conversas por mensagem iniciadas");
    expect(text).toContain("4.162 visitas ao perfil do instagram");
    expect(text).toContain("30.583 engajamento com a publicação");
    expect(text.match(/cada\)/g)).toHaveLength(3);
    expect(text).not.toMatch(/principal/i);
  });

  it("sem resultados o resumo fala só do investimento", () => {
    const facts = buildReportFacts(data({ summary: { spend: 100 }, campaigns: [] }));
    expect(summaryParts(facts).map(part => part.text).join("")).toBe("Neste período você investiu R$ 100,00.");
  });

  it("o tom da variação depende do que é desejável para a métrica", () => {
    expect(toneFor(10, "up")).toBe("good");
    expect(toneFor(-10, "up")).toBe("bad");
    expect(toneFor(-10, "down")).toBe("good");
    expect(toneFor(10, "neutral")).toBe("neutral");
    expect(toneFor(null, "up")).toBe("neutral");
  });

  it("rótulos de variação distinguem sem comparação de sem base", () => {
    expect(changeLabel(14.1, true)).toBe("+14,1% vs. anterior");
    expect(changeLabel(null, true)).toBe("Sem base de comparação");
    expect(changeLabel(5, false)).toBe("Sem comparação");
  });

  it("o teto do eixo é redondo", () => {
    expect(niceMax(188)).toBe(200);
    expect(niceMax(24)).toBe(25);
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3649)).toBe(5000);
  });
});

describe("chave e ligações do PDF novo", () => {
  it("fica desligado por padrão e nunca assume a apresentação horizontal", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORT_PDF_V2", "");
    expect(isReportPdfV2Enabled()).toBe(false);
    expect(usesReportPdfV2({ orientation: "vertical" })).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_REPORT_PDF_V2", "1");
    expect(usesReportPdfV2({ orientation: "vertical" })).toBe(true);
    expect(usesReportPdfV2({})).toBe(true);
    expect(usesReportPdfV2({ orientation: "horizontal" })).toBe(false);
    vi.unstubAllEnvs();
  });

  it("o layout escolhido pela organização liga o PDF novo só nos verticais", () => {
    vi.stubEnv("NEXT_PUBLIC_REPORT_PDF_V2", "");
    expect(usesReportPdfV2({ orientation: "vertical", layout: "modern" })).toBe(true);
    expect(usesReportPdfV2({ layout: "modern" })).toBe(true);
    expect(usesReportPdfV2({ orientation: "vertical", layout: "classic" })).toBe(false);
    expect(usesReportPdfV2({ orientation: "horizontal", layout: "modern" })).toBe(false);
    vi.unstubAllEnvs();
  });

  it("converte a entrada do gerador antigo sem perder análise nem hierarquia", () => {
    const source = { title: "T", clientName: "C", workspaceName: "W", headerDetails: "", data: data(), metrics: [], entityLabels: [], accountLabels: [], comparison: false, chartType: "line" as const, analysisNote: "Nota", entityRows: [] };
    expect(toReportPdfInput(source)).toMatchObject({ clientName: "C", workspaceName: "W", analysisNote: "Nota", entityRows: [] });
  });

  it("o envio agendado gera o PDF novo com nome de arquivo e período", async () => {
    const result = await buildPeriodPdfV2({ clientName: "Escola Horizonte", workspaceName: "iGrow Digital", data: data() });
    expect(result.filename).toBe("Escola-Horizonte-2026-09-12-2026-10-10.pdf");
    expect(result.period).toBe("12/09/2026 a 10/10/2026");
    expect(Buffer.from(await result.blob.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("PDF com uma seção por conta", () => {
  it("gera um só arquivo com as duas contas, com mais páginas que o relatório de uma conta", async () => {
    const one = pageCount(await render(input({ audience: undefined, balances: undefined })));
    const blob = await buildPeriodPdfV2({
      clientName: "RM", workspaceName: "iGrow", data: data(),
      accounts: [{ name: "RM Imobiliária", data: data() }, { name: "Ronaldo Moreira", data: data() }],
    });
    const bytes = Buffer.from(await blob.blob.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(bytes)).toBeGreaterThan(one);
  });

  it("recusa quando uma das contas não tem o período completo", async () => {
    const partial = data({ coverage: { ...data().coverage, status: "partial" } });
    await expect(buildPeriodPdfV2({ clientName: "RM", workspaceName: "iGrow", data: data(), accounts: [{ name: "A", data: partial }] })).rejects.toThrow();
  });
});

describe("rótulos do relatório", () => {
  it("o resultado de cliques no link das campanhas de tráfego não se confunde com o indicador de cliques", () => {
    const LINK = "result:provider:action:link_click";
    const base = data();
    const facts = buildReportFacts({ ...base, summary: { ...base.summary, [LINK]: 2217, "result:provider_known": 1 }, campaigns: [
      { id: "t1", name: "Tráfego", accountName: "A", accountId: "b", currency: "BRL", status: null, values: { spend: 482.06, "result:provider_known": 1, [LINK]: 2217 } },
    ] });
    const labels = facts.results.map(result => result.label);
    expect(labels).toContain("Cliques no link das campanhas de tráfego");
    expect(labels).not.toContain("Cliques no link");
  });
});

describe("relatório de uma conta", () => {
  it("mostra o nome da conta quando o cliente tem várias e só uma foi escolhida", () => {
    const base = data({ accounts: [
      { id: "a", name: "Escola Crescer", externalId: "1", timezoneName: "America/Sao_Paulo", currency: "BRL" },
      { id: "b", name: "Colégio Crescer", externalId: "2", timezoneName: "America/Sao_Paulo", currency: "BRL" },
    ] });
    const doc = { title: "t", clientName: "Colégio Crescer", workspaceName: "w", headerDetails: "", data: base, metrics: [], entityLabels: [], accountLabels: [], comparison: false, chartType: "line" as const };
    expect(toReportPdfInput({ ...doc, data: { ...base, selectedAccountIds: ["a"] } } as never).accountLabel).toBe("Escola Crescer");
    expect(toReportPdfInput({ ...doc, data: { ...base, selectedAccountIds: ["a", "b"] } } as never).accountLabel).toBeUndefined();
  });
});
