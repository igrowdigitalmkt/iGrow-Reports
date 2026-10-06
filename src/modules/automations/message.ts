import { resultCostBreakdown } from "@/modules/client-portal/analytics-results";
import type { AnalyticsDashboardData } from "@/modules/client-portal/analytics-types";
import type { MessageTemplateSegment } from "@/types/database";

export type MessageContext = {
  clientName: string;
  recipientName?: string | null;
  workspaceName?: string | null;
  dashboardUrl?: string | null;
  data: AnalyticsDashboardData | null;
};

export type MessageVariable = { key: string; label: string; group: "Geral" | "Investimento" | "Alcance" | "Resultados" | "Custos" };

// Friendly names typed as {{chave}}. Kept in Portuguese without accents so they are easy to type.
export const MESSAGE_VARIABLES: MessageVariable[] = [
  { key: "nome", label: "Nome do destinatário", group: "Geral" },
  { key: "cliente", label: "Nome do cliente", group: "Geral" },
  { key: "periodo", label: "Período", group: "Geral" },
  { key: "equipe", label: "Nome da agência", group: "Geral" },
  { key: "link_painel", label: "Link do painel", group: "Geral" },
  { key: "investimento", label: "Valor investido", group: "Investimento" },
  { key: "receita", label: "Receita das compras", group: "Investimento" },
  { key: "roas", label: "ROAS", group: "Investimento" },
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
  { key: "compras", label: "Compras", group: "Resultados" },
  { key: "seguidores", label: "Novos seguidores", group: "Resultados" },
  { key: "visitas_perfil", label: "Visitas ao perfil", group: "Resultados" },
  { key: "custo_conversa", label: "Custo por conversa", group: "Custos" },
  { key: "custo_lead", label: "Custo por lead", group: "Custos" },
  { key: "custo_cadastro", label: "Custo por cadastro", group: "Custos" },
  { key: "custo_compra", label: "Custo por compra", group: "Custos" },
  { key: "custo_seguidor", label: "Custo por seguidor", group: "Custos" },
];

const KNOWN = new Set(MESSAGE_VARIABLES.map(variable => variable.key));
const PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/gi;
const OPT_OUT = "\n\n_Para não receber mais estas mensagens, responda PARAR._";

export type SystemTemplate = { id: string; name: string; segment: MessageTemplateSegment; description: string; body: string };

export const SEGMENT_LABELS: Record<MessageTemplateSegment, string> = {
  geral: "Geral",
  mensagens: "Conversas no WhatsApp/Direct",
  vendas: "Vendas e e-commerce",
  leads: "Leads e cadastros",
  seguidores: "Seguidores e perfil",
  trafego: "Tráfego para o site",
  reconhecimento: "Alcance e reconhecimento",
};

// Ready-made templates, one for each of the most common campaign goals.
export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    id: "sistema-geral", name: "Resumo completo", segment: "geral", description: "Investimento, alcance, cliques e todos os resultados do período.",
    body: "Olá, {{nome}}! 👋\n\nSegue o resumo de *{{cliente}}* ({{periodo}}):\n\n💰 Investimento: *{{investimento}}*\n👀 Alcance: {{alcance}} pessoas\n📢 Impressões: {{impressoes}}\n🖱️ Cliques: {{cliques}} (CTR {{ctr}})\n\n🎯 *Resultados*\n{{resultados}}\n\nQualquer dúvida, é só chamar por aqui." + OPT_OUT,
  },
  {
    id: "sistema-mensagens", name: "Conversas iniciadas", segment: "mensagens", description: "Para campanhas que levam ao WhatsApp, Messenger ou Direct.",
    body: "Olá, {{nome}}! 💬\n\nEm {{periodo}}, os anúncios de *{{cliente}}* geraram *{{conversas}} conversas* iniciadas.\n\n💰 Investimento: {{investimento}}\n📉 Custo por conversa: *{{custo_conversa}}*\n👀 Alcance: {{alcance}} pessoas\n\nVale conferir se todas as conversas foram respondidas. 😉" + OPT_OUT,
  },
  {
    id: "sistema-vendas", name: "Vendas", segment: "vendas", description: "Compras, receita, ROAS e custo por compra.",
    body: "Olá, {{nome}}! 🛒\n\nResultado de vendas de *{{cliente}}* em {{periodo}}:\n\n✅ Compras: *{{compras}}*\n💵 Receita: *{{receita}}*\n📈 ROAS: *{{roas}}*\n💰 Investimento: {{investimento}}\n🎯 Custo por compra: {{custo_compra}}\n\nQualquer dúvida, estamos por aqui." + OPT_OUT,
  },
  {
    id: "sistema-leads", name: "Leads e cadastros", segment: "leads", description: "Para formulários, cadastros e captação de contatos.",
    body: "Olá, {{nome}}! 📋\n\nCaptação de *{{cliente}}* em {{periodo}}:\n\n✅ Leads: *{{leads}}* (custo de {{custo_lead}} cada)\n📝 Cadastros: *{{cadastros}}* (custo de {{custo_cadastro}} cada)\n💰 Investimento: {{investimento}}\n🖱️ Cliques: {{cliques}} (CTR {{ctr}})\n\nLembrete: quanto mais rápido o primeiro contato, maior a chance de conversão." + OPT_OUT,
  },
  {
    id: "sistema-seguidores", name: "Seguidores e perfil", segment: "seguidores", description: "Crescimento do Instagram: seguidores e visitas ao perfil.",
    body: "Olá, {{nome}}! 📸\n\nCrescimento do perfil de *{{cliente}}* em {{periodo}}:\n\n➕ Novos seguidores: *{{seguidores}}* ({{custo_seguidor}} cada)\n👤 Visitas ao perfil: {{visitas_perfil}}\n👀 Alcance: {{alcance}} pessoas\n💰 Investimento: {{investimento}}" + OPT_OUT,
  },
  {
    id: "sistema-trafego", name: "Tráfego para o site", segment: "trafego", description: "Cliques, CTR e custo por clique.",
    body: "Olá, {{nome}}! 🌐\n\nTráfego de *{{cliente}}* em {{periodo}}:\n\n🖱️ Cliques no link: *{{cliques}}*\n📊 CTR: {{ctr}}\n💸 CPC: *{{cpc}}*\n👀 Alcance: {{alcance}} pessoas\n💰 Investimento: {{investimento}}" + OPT_OUT,
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
    ratio: (value: number | null | undefined) => ok(value) ? `${decimal.format(value)}x` : "—",
  };
}

// Plural label for a result family, used inside the "resultados" list.
const RESULT_NOUNS: Record<string, string> = {
  messages: "conversas iniciadas",
  profile_visits: "visitas ao perfil",
  leads: "leads",
  registrations: "cadastros concluídos",
  purchases: "compras",
  instagram_profile_follow: "novos seguidores",
  "action:link_click": "cliques no link",
};

const FOLLOW_KEYS = ["instagram_profile_follow", "action:instagram_profile_follow", "action:onsite_conversion.follow"];

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
  const result = (key: string) => results.find(item => item.key === key);
  const family = (key: string) => format.integer(result(key)?.value ?? (data ? 0 : null));
  const cost = (key: string) => format.money(result(key)?.cost ?? null);
  // Followers may come as the campaign result or as a separate Instagram metric.
  const followerResult = result("instagram_profile_follow");
  const followers = followerResult?.value ?? FOLLOW_KEYS.map(key => summary[key]).find(value => value != null) ?? (data ? 0 : null);
  const followerCost = followerResult?.cost ?? (followers && summary.spend != null && results.length <= 1 ? summary.spend / followers : null);
  const revenue = summary.attributed_revenue ?? null;
  const roas = summary.roas ?? (revenue != null && summary.spend ? revenue / summary.spend : null);
  return {
    nome: context.recipientName?.trim().split(/\s+/)[0] || "tudo bem",
    cliente: context.clientName,
    periodo: data ? periodText(data.dateFrom, data.dateTo) : "—",
    equipe: context.workspaceName || "",
    link_painel: context.dashboardUrl || "",
    investimento: format.money(summary.spend),
    receita: format.money(revenue),
    roas: format.ratio(roas),
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
    compras: family("purchases"),
    seguidores: format.integer(followers),
    visitas_perfil: family("profile_visits"),
    custo_conversa: cost("messages"),
    custo_lead: cost("leads"),
    custo_cadastro: cost("registrations"),
    custo_compra: cost("purchases"),
    custo_seguidor: format.money(followerCost),
  };
}

// Unknown variables stay visible as typed so a typo is noticed in the preview.
export function renderMessage(template: string, context: MessageContext) {
  const values = messageValues(context);
  return template.replace(PATTERN, (whole, key: string) => values[key.toLowerCase()] ?? whole).replace(/\n{3,}/g, "\n\n").trim();
}
