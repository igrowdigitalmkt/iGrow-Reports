import type { PortfolioSummary } from "./portfolio-view";
import type { DashboardPeriod, DashboardSnapshot, ReportRow } from "./dashboard-data";

// Cenário fictício fixo, isolado: nunca gravar estes dados no banco operacional.
export const demoClients = [
  { name: "Aurora Studio", initials: "AS", color: "violet", segment: "Arquitetura e interiores", result: "Leads no site", accounts: 2 },
  { name: "Verde & Grão", initials: "VG", color: "green", segment: "Alimentação saudável", result: "Compras", accounts: 1 },
  { name: "Órbita Fit", initials: "OF", color: "blue", segment: "Saúde e bem-estar", result: "Conversas iniciadas", accounts: 1 },
  { name: "Casa Nativa", initials: "CN", color: "amber", segment: "Decoração", result: "Compras", accounts: 2 },
  { name: "Escola Horizonte", initials: "EH", color: "cyan", segment: "Educação", result: "Leads em formulário", accounts: 1 },
  { name: "Lumina Estética", initials: "LE", color: "pink", segment: "Estética", result: "Conversas iniciadas", accounts: 1 },
];

export const demoReports: ReportRow[] = demoClients.slice(0, 5).map((client, index) => ({
  id: `DEMO-00${index + 1}`, client: client.name, initials: client.initials, color: client.color,
  type: index === 1 || index === 3 ? "Vendas" : index === 2 ? "Conversas" : "Captação de leads",
  date: "23 – 29 set, 2026", status: index === 1 ? "Aguardando aprovação" : index === 4 ? "Processando" : "Entregue", recipients: 2,
}));

const thirtyGenerated = [1,2,1,0,0,3,4,2,3,1,0,0,4,5,2,3,2,0,0,4,5,2,3,2,0,0,4,6,3,4];
const thirtyDelivered = [2,3,2,0,0,5,6,3,5,2,0,0,6,8,3,5,3,0,0,6,8,3,5,3,0,0,6,9,4,6];

export function getDemoSnapshot(period: DashboardPeriod): DashboardSnapshot {
  const generatedSeries = period === "7d" ? thirtyGenerated.slice(-7) : thirtyGenerated;
  const deliveredSeries = period === "7d" ? thirtyDelivered.slice(-7) : thirtyDelivered;
  const delivered = deliveredSeries.reduce((sum, value) => sum + value, 0);
  return {
    activeClients: demoClients.length,
    reportsGenerated: generatedSeries.reduce((sum, value) => sum + value, 0),
    accepted: delivered + 2, delivered, read: Math.floor(delivered * .84), accessed: Math.floor(delivered * .67), upcoming: 4,
    labels: Array.from({ length: generatedSeries.length }, (_, i) => `${String(i + (period === "7d" ? 24 : 1)).padStart(2, "0")} set`),
    generatedSeries, deliveredSeries, reports: demoReports,
  };
}


// Carteira fictícia da Visão geral (valores fixos, apenas para demonstração).
const demoTrend = (seed: number, base: number) => Array.from({ length: 30 }, (_, day) => Math.max(0, Math.round(base * (0.75 + 0.35 * Math.sin(day / 3 + seed) + 0.15 * Math.cos(day * seed)))));
export const demoPortfolio: PortfolioSummary = {
  reportsGenerated: 66,
  periodLabel: "Últimos 30 dias",
  rows: [
    { id: "demo-4", name: "Escola Horizonte", linkedAccounts: 1, status: "ok", currency: "BRL", resultLabel: "leads", spend: 3885.18, previousSpend: 3456.2, results: 1366, previousResults: 1169, trend: demoTrend(1, 130) },
    { id: "demo-0", name: "Aurora Studio", linkedAccounts: 2, status: "ok", currency: "BRL", resultLabel: "leads", spend: 2140.5, previousSpend: 2231.4, results: 214, previousResults: 220, trend: demoTrend(2, 71) },
    { id: "demo-1", name: "Verde & Grão", linkedAccounts: 1, status: "no-delivery", currency: "BRL", resultLabel: "compras", spend: 1710, previousSpend: 1405, results: 96, previousResults: 81, trend: [...demoTrend(3, 70).slice(0, 23), 0, 0, 0, 0, 0, 0, 0] },
    { id: "demo-2", name: "Órbita Fit", linkedAccounts: 1, status: "cost-up", currency: "BRL", resultLabel: "conversas", spend: 1265.9, previousSpend: 1190, results: 388, previousResults: 471, trend: demoTrend(4, 42) },
    { id: "demo-5", name: "Lumina Estética", linkedAccounts: 1, status: "ok", currency: "BRL", resultLabel: "conversas", spend: 980.4, previousSpend: 921.1, results: 142, previousResults: 133, trend: demoTrend(5, 33) },
    { id: "demo-3", name: "Casa Nativa", linkedAccounts: 0, status: "no-accounts", currency: null, resultLabel: "compras", spend: null, previousSpend: null, results: null, previousResults: null, trend: [] },
  ],
};
