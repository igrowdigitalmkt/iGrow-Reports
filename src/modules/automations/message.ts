import { resultCostBreakdown } from "@/modules/client-portal/analytics-results";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";

export type MessageContext = {
  clientName: string;
  recipientName?: string | null;
  workspaceName?: string | null;
  dashboardUrl?: string | null;
  data: AnalyticsDashboardData | null;
};

export type MessageVariable = { key: string; label: string; group: "Geral" | "Investimento" | "Alcance" | "Resultados" };

// Friendly names typed as {{chave}}. Kept in Portuguese without accents so they are easy to type.
export const MESSAGE_VARIABLES: MessageVariable[] = [
  { key: "nome", label: "Nome do destinatário", group: "Geral" },
  { key: "cliente", label: "Nome do cliente", group: "Geral" },
  { key: "periodo", label: "Período", group: "Geral" },
  { key: "equipe", label: "Nome da agência", group: "Geral" },
  { key: "link_painel", label: "Link do painel", group: "Geral" },
  { key: "investimento", label: "Valor investido", group: "Investimento" },
  { key: "cpm", label: "CPM", group: "Investimento" },
  { key: "cpc", label: "CPC", group: "Investimento" },
  { key: "impressoes", label: "Impressões", group: "Alcance" },
  { key: "alcance", label: "Alcance", group: "Alcance" },
  { key: "frequencia", label: "Frequência", group: "Alcance" },
  { key: "cliques", label: "Cliques no link", group: "Alcance" },
  { key: "ctr", label: "CTR", group: "Alcance" },
  { key: "resultados", label: "Lista de resultados", group: "Resultados" },
  { key: "conversas", label: "Conversas iniciadas", group: "Resultados" },
  { key: "leads", label: "Leads", group: "Resultados" },
  { key: "cadastros", label: "Cadastros", group: "Resultados" },
  { key: "visitas_perfil", label: "Visitas ao perfil", group: "Resultados" },
  { key: "compras", label: "Compras", group: "Resultados" },
];

const KNOWN = new Set(MESSAGE_VARIABLES.map(variable => variable.key));
const PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export const MESSAGE_PRESETS = [
  {
    name: "Resumo completo",
    text: "Olá, {{nome}}! 👋\n\nSegue o resumo de *{{cliente}}* ({{periodo}}):\n\n💰 Investimento: *{{investimento}}*\n👀 Alcance: {{alcance}} pessoas\n📢 Impressões: {{impressoes}}\n🖱️ Cliques: {{cliques}} (CTR {{ctr}})\n\n🎯 *Resultados*\n{{resultados}}\n\nQualquer dúvida, é só chamar por aqui.",
  },
  {
    name: "Curto",
    text: "Bom dia, {{nome}}! Em {{periodo}}, {{cliente}} investiu {{investimento}} e teve:\n{{resultados}}",
  },
  {
    name: "Com link do painel",
    text: "Olá, {{nome}}! Os números de {{cliente}} em {{periodo}} já estão atualizados.\n\n💰 {{investimento}} investidos\n\n🎯 *Resultados*\n{{resultados}}\n\nVeja os detalhes no painel: {{link_painel}}",
  },
];

export function unknownVariables(template: string) {
  return [...new Set([...template.matchAll(PATTERN)].map(match => match[1].toLowerCase()).filter(key => !KNOWN.has(key)))];
}

export function usedVariables(template: string) {
  return [...new Set([...template.matchAll(PATTERN)].map(match => match[1].toLowerCase()).filter(key => KNOWN.has(key)))];
}

const brDate = (value: string) => value.split("-").reverse().join("/");

export function periodText(dateFrom: string, dateTo: string) {
  return dateFrom === dateTo ? brDate(dateFrom) : `${brDate(dateFrom)} a ${brDate(dateTo)}`;
}

function formatters(currency: string | null) {
  const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" });
  const ok = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
  return {
    integer: (value: number | null | undefined) => ok(value) ? integer.format(value) : "—",
    decimal: (value: number | null | undefined) => ok(value) ? decimal.format(value) : "—",
    money: (value: number | null | undefined) => ok(value) ? money.format(value) : "—",
    percent: (value: number | null | undefined) => ok(value) ? `${decimal.format(value)}%` : "—",
  };
}

// Plural label for a result family, used inside the "resultados" list.
const RESULT_NOUNS: Record<string, string> = {
  messages: "conversas iniciadas",
  profile_visits: "visitas ao perfil",
  leads: "leads",
  registrations: "cadastros concluídos",
  purchases: "compras",
};

export function messageValues(context: MessageContext): Record<string, string> {
  const data = context.data;
  const format = formatters(data?.currency ?? null);
  const summary = data?.summary ?? {};
  const results = data ? resultCostBreakdown(summary, data.campaigns.map(campaign => ({
    values: campaign.values, level: "campaign" as const, id: campaign.id, accountId: campaign.accountId,
  }))).sort((a, b) => b.value - a.value) : [];
  const list = results.length
    ? results.map(result => `• ${format.integer(result.value)} ${RESULT_NOUNS[result.key] ?? result.label.toLowerCase()}${result.cost != null ? ` (${format.money(result.cost)} cada)` : ""}`).join("\n")
    : "• Sem resultados no período";
  const family = (key: string) => format.integer(results.find(result => result.key === key)?.value ?? (data ? 0 : null));
  return {
    nome: context.recipientName?.trim().split(/\s+/)[0] || "tudo bem",
    cliente: context.clientName,
    periodo: data ? periodText(data.dateFrom, data.dateTo) : "—",
    equipe: context.workspaceName || "",
    link_painel: context.dashboardUrl || "",
    investimento: format.money(summary.spend),
    cpm: format.money(summary.cpm),
    cpc: format.money(summary.cpc_link),
    impressoes: format.integer(summary.impressions),
    alcance: format.integer(summary.reach),
    frequencia: format.decimal(summary.frequency),
    cliques: format.integer(summary.link_clicks),
    ctr: format.percent(summary.ctr_link),
    resultados: list,
    conversas: family("messages"),
    leads: family("leads"),
    cadastros: family("registrations"),
    visitas_perfil: family("profile_visits"),
    compras: family("purchases"),
  };
}

// Unknown variables stay visible as typed so a typo is noticed in the preview.
export function renderMessage(template: string, context: MessageContext) {
  const values = messageValues(context);
  return template.replace(PATTERN, (whole, key: string) => values[key.toLowerCase()] ?? whole).replace(/\n{3,}/g, "\n\n").trim();
}
