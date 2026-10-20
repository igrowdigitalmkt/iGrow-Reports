import { ANALYTICS_REFRESH_MS } from "@/modules/client-portal/analytics-freshness";
import { resultBreakdown } from "@/modules/client-portal/analytics-results";
import type { AnalyticsMetric, AnalyticsValues } from "@/modules/client-portal/analytics-types";
import { BASE_METRIC_KEYS, buildCostIndex, eventCost, resultState, rowKey, type CostIndex } from "../../columns";
import type { CampaignsData } from "../../load";
import type { CampaignRow } from "../../tree";
import type { AssistantTarget } from "../request";

// Montagem dos FATOS que o modelo poderá usar. Tudo é produzido no servidor a partir dos dados já confirmados e autorizados;
// nada vem do navegador. A ausência de dado nunca vira zero, e cada fato carrega a sua situação.
// Cada entidade tem um marcador (e1, e2...) e cada valor derivado um marcador (d1, d2...): o modelo cita valores por marcador e o
// servidor os escreve (ver markers.ts); os cálculos derivados são feitos aqui, de forma determinística, nunca pelo modelo.

export const FACT_LIMITS = { maxEntities: 40, maxChildrenPerLevel: 20, maxChars: 30_000, maxDerived: 30, maxShares: 10, maxNameChars: 120 };
export const FACTS_VERSION = 2;

export type Intent = "delivery" | "compare" | "ranking" | "spend" | "performance";
const INTENT_PATTERNS: Array<[Intent, RegExp]> = [
  ["delivery", /entreg|veicul|pausad|reprovad|em an[aá]lise|status|(?<!\p{L})ativ[oa]s?(?!\p{L})|restri|n[aã]o est[aá]/iu],
  ["compare", /compar|versus|(?<!\p{L})vs(?!\p{L})|diferen/iu],
  ["ranking", /(?<!\p{L})(?:mais|menos)(?!\p{L})|maior|menor|melhor|pior|ranking|(?<!\p{L})top(?!\p{L})/iu],
  ["spend", /invest|gast|custo|cpc|cpm|or[cç]amento/i],
  ["performance", /desempenho|resultado|analis|convers|lead|mensag|compra|ctr|clique|impress/i],
];
/** Prioriza dados pela pergunta: sem pista clara, vale o desempenho geral. */
export function detectIntents(question: string): Intent[] {
  const found = INTENT_PATTERNS.filter(([, pattern]) => pattern.test(question)).map(([intent]) => intent);
  return found.length ? found : ["performance"];
}

export type MetricStatus = "confirmed" | "zero_confirmed" | "unavailable" | "absent";
export type MetricFact = { key: string; label: string; unit: AnalyticsMetric["unit"]; value: number | null; status: MetricStatus };
export type ResultFact = { n: number; type: string; value: number; attributedCost: number | null; referenceCostPerEvent: number | null };
export type EntityFact = {
  /** Marcador da entidade nos textos do modelo: {e1.spend}, {e1.result1}, {e1.attributed1}, {e1.reference1}. */
  id: string;
  ref: { level: CampaignRow["level"]; id: string; name: string };
  role: "target" | "parent" | "child" | "listed";
  accountId: string; accountName: string; currency: string;
  parent: { level: CampaignRow["level"]; id: string; name: string } | null;
  delivery: { label: string; group: string; configured: string | null; effective: string | null; restrictions: string[]; source: "live" | "live_cached" | "unavailable" };
  metrics: MetricFact[];
  resultsStatus: MetricStatus;
  results: ResultFact[];
};
/** Valor derivado calculado pelo servidor; citado como {d1}. `unit` define a formatação. */
export type DerivedFact = { id: string; label: string; value: number; unit: "currency" | "integer" | "percent"; currency?: string; basis: string; about?: string };
export type AssistantFacts = {
  version: number; generatedAt: string;
  scope: { level: string; client: string; accounts: { name: string; currency: string }[]; entity: { level: string; id: string; name: string } | null };
  period: { dateFrom: string; dateTo: string };
  source: { metrics: string; collectedAt: string | null; metricsAgeHours: number | null; live: { state: string; checkedAt: string | null; cached: boolean; accountsRead: number; accountsTotal: number } };
  currencies: string[];
  counts: { included: number; available: number; truncated: number };
  intents: Intent[];
  entities: EntityFact[];
  derived: DerivedFact[];
  limitations: string[];
};

const hasData = (values: AnalyticsValues) => Object.keys(values).length > 0;
const bySpendDesc = (a: CampaignRow, b: CampaignRow) => (b.values.spend ?? -1) - (a.values.spend ?? -1) || a.name.localeCompare(b.name, "pt-BR");
/** Nomes vêm da plataforma de anúncios: são dados, nunca instruções. Remove caracteres de controle e limita o tamanho. */
const cleanName = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, FACT_LIMITS.maxNameChars);

function metricFact(row: CampaignRow, key: string, metrics: AnalyticsMetric[]): MetricFact | null {
  const metric = metrics.find(item => item.key === key);
  if (!metric) return null;
  const value = row.values[key] ?? null;
  const status: MetricStatus = !hasData(row.values) ? "absent" : value == null ? "unavailable" : value === 0 ? "zero_confirmed" : "confirmed";
  return { key, label: metric.label, unit: metric.unit, value, status };
}

function entityFact(row: CampaignRow, role: EntityFact["role"], id: string, data: CampaignsData, index: CostIndex, keys: string[], byKey: Map<string, CampaignRow>): EntityFact {
  const state = resultState(row.values);
  const parent = row.parentId ? byKey.get(`${row.accountId}:${row.level === "ad" ? "adset" : "campaign"}:${row.parentId}`) : undefined;
  const live = data.live.state === "unavailable" ? "unavailable" : data.live.cached ? "live_cached" : "live";
  return {
    id, ref: { level: row.level, id: row.id, name: cleanName(row.name) }, role, accountId: row.accountId, accountName: cleanName(row.accountName), currency: row.currency,
    parent: parent ? { level: parent.level, id: parent.id, name: cleanName(parent.name) } : null,
    delivery: { label: row.state.label, group: row.state.group, configured: row.state.configured?.code ?? null, effective: row.state.effective?.code ?? null, restrictions: row.state.restrictions.map(item => item.label), source: live },
    metrics: keys.flatMap(key => metricFact(row, key, data.metrics) ?? []),
    resultsStatus: state === "none" ? "absent" : state === "unknown" ? "unavailable" : state === "zero" ? "zero_confirmed" : "confirmed",
    results: resultBreakdown(row.values).map((result, i) => ({ n: i + 1, type: result.label, value: result.value,
      attributedCost: index.get(rowKey(row))?.get(result.key) ?? null, referenceCostPerEvent: eventCost(row.values, result.key) })),
  };
}

/**
 * Seleciona só o que o contexto pede: um anúncio não traz a carteira. Devolve as linhas em ordem de prioridade e quantas existiam.
 * `rows` já deve conter apenas entidades das contas autorizadas (o chamador valida o alvo antes).
 */
export function selectRows(rows: CampaignRow[], target: AssistantTarget) {
  const byKey = new Map(rows.map(row => [rowKey(row), row] as const));
  const children = (row: CampaignRow, level: CampaignRow["level"]) => rows.filter(item => item.accountId === row.accountId && item.level === level && item.parentId === row.id).sort(bySpendDesc);
  const parentOf = (row: CampaignRow) => row.parentId ? byKey.get(`${row.accountId}:${row.level === "ad" ? "adset" : "campaign"}:${row.parentId}`) : undefined;
  if (target.level === "client" || target.level === "account") {
    const campaigns = rows.filter(row => row.level === "campaign").sort(bySpendDesc);
    return { ordered: campaigns.map(row => ({ row, role: "listed" as const })), available: campaigns.length, peers: campaigns.length };
  }
  const entity = rows.find(row => row.accountId === target.accountId && row.level === target.level && row.id === target.entityId)!;
  const parent = parentOf(entity);
  const grand = parent ? parentOf(parent) : undefined;
  if (target.level === "campaign") {
    const sets = children(entity, "adset");
    const ads = sets.flatMap(set => children(set, "ad"));
    return { ordered: [{ row: entity, role: "target" as const }, ...sets.slice(0, FACT_LIMITS.maxChildrenPerLevel).map(row => ({ row, role: "child" as const })), ...ads.slice(0, FACT_LIMITS.maxChildrenPerLevel).map(row => ({ row, role: "child" as const }))], available: 1 + sets.length + ads.length, peers: sets.length };
  }
  if (target.level === "adset") {
    const ads = children(entity, "ad");
    return { ordered: [{ row: entity, role: "target" as const }, ...(parent ? [{ row: parent, role: "parent" as const }] : []), ...ads.slice(0, FACT_LIMITS.maxChildrenPerLevel).map(row => ({ row, role: "child" as const }))], available: 1 + (parent ? 1 : 0) + ads.length, peers: ads.length };
  }
  return { ordered: [{ row: entity, role: "target" as const }, ...(parent ? [{ row: parent, role: "parent" as const }] : []), ...(grand ? [{ row: grand, role: "parent" as const }] : [])], available: 1 + (parent ? 1 : 0) + (grand ? 1 : 0), peers: 0 };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Valores derivados, calculados aqui e nunca pelo modelo. Só entre entidades do MESMO nível (pares), com moeda única, todas incluídas
 * (sem corte) e todas com dado confirmado: caso contrário o total não é calculado e a limitação é declarada.
 */
export function buildDerived(entities: EntityFact[], peerLevel: CampaignRow["level"] | null, peersAvailable: number): { derived: DerivedFact[]; notes: string[] } {
  const peers = peerLevel ? entities.filter(entity => entity.ref.level === peerLevel && (entity.role === "listed" || entity.role === "child")) : [];
  const notes: string[] = [];
  if (peers.length < 2) return { derived: [], notes };
  const currencies = new Set(peers.map(peer => peer.currency));
  const spendOf = (peer: EntityFact) => peer.metrics.find(metric => metric.key === "spend");
  const complete = peers.length === peersAvailable && peers.every(peer => spendOf(peer)?.value != null && (spendOf(peer)?.status === "confirmed" || spendOf(peer)?.status === "zero_confirmed"));
  if (!complete || currencies.size !== 1) {
    notes.push("Totais e participações não foram calculados: há entidades cortadas, sem dado confirmado ou com moedas diferentes.");
    return { derived: [], notes };
  }
  const currency = [...currencies][0]!;
  const derived: DerivedFact[] = [];
  const next = () => `d${derived.length + 1}`;
  const total = peers.reduce((sum, peer) => sum + (spendOf(peer)!.value as number), 0);
  derived.push({ id: next(), label: `Investimento total das ${peers.length} entidades listadas (${peerLevel === "campaign" ? "campanhas" : peerLevel === "adset" ? "conjuntos" : "anúncios"})`, value: total, unit: "currency", currency, basis: "soma do investimento confirmado das entidades listadas" });
  const types = new Map<string, number>();
  const resultsKnown = peers.every(peer => peer.resultsStatus === "confirmed" || peer.resultsStatus === "zero_confirmed");
  if (resultsKnown) for (const peer of peers) for (const result of peer.results) types.set(result.type, (types.get(result.type) ?? 0) + result.value);
  for (const [type, value] of types) derived.push({ id: next(), label: `Total de ${type}`, value, unit: "integer", basis: "soma entre entidades que registram o mesmo tipo de resultado" });
  if (total > 0) {
    for (const peer of [...peers].sort((a, b) => (spendOf(b)!.value as number) - (spendOf(a)!.value as number)).slice(0, FACT_LIMITS.maxShares)) {
      derived.push({ id: next(), label: "Participação no investimento total", value: round1((spendOf(peer)!.value as number) / total * 100), unit: "percent", basis: "investimento da entidade ÷ investimento total das entidades listadas", about: peer.id });
    }
  }
  return { derived: derived.slice(0, FACT_LIMITS.maxDerived), notes };
}

export function buildAssistantFacts(input: { data: CampaignsData; target: AssistantTarget; clientName: string; question: string; now: number }): AssistantFacts {
  const { data, target, question, now } = input;
  const intents = detectIntents(question);
  const inScope = (accountId: string) => target.level === "client" ? target.accountIds.includes(accountId) : accountId === target.accountId;
  const rows = data.rows.filter(row => inScope(row.accountId));
  const index = buildCostIndex(rows);
  const byKey = new Map(rows.map(row => [rowKey(row), row] as const));
  const deliveryOnly = intents.length === 1 && intents[0] === "delivery";
  const keys = deliveryOnly ? ["spend"] : BASE_METRIC_KEYS;
  const { ordered, available, peers: peersAvailable } = selectRows(rows, target);
  const consideredAccounts = data.accounts.filter(account => inScope(account.id) && data.selectedAccountIds.includes(account.id));
  const targetRow = ordered.find(item => item.role === "target")?.row ?? null;

  let selected = ordered.slice(0, FACT_LIMITS.maxEntities);
  const build = (items: typeof selected) => items.map((item, i) => entityFact(item.row, item.role, `e${i + 1}`, data, index, keys, byKey));
  const collectedMs = Date.parse(data.latestCollectedAt ?? "");
  const metricsAge = Number.isFinite(collectedMs) ? Math.max(0, (now - collectedMs) / 3_600_000) : null;
  const limitations: string[] = ["Somente Meta Ads. A análise é consultiva: nenhuma alteração é feita a partir desta conversa."];
  if (data.live.state === "unavailable") limitations.push("O estado atual de veiculação não pôde ser consultado na Meta: não afirme o estado atual de nenhuma entidade.");
  else if (data.live.state === "partial") limitations.push(`O estado atual foi consultado em apenas ${data.live.accountsRead} de ${data.live.accountsTotal} contas; para as demais o estado é indisponível.`);
  else if (data.live.cached) limitations.push("O estado atual vem de uma leitura reaproveitada de até 45 segundos.");
  if (metricsAge == null) limitations.push("A data da última coleta das métricas é desconhecida.");
  else if (metricsAge * 3_600_000 >= ANALYTICS_REFRESH_MS) limitations.push(`As métricas foram coletadas há ${Math.floor(metricsAge)} horas e podem estar desatualizadas.`);
  limitations.push("Métricas e resultados com situação 'absent' não têm dado confirmado (não é zero); 'unavailable' indica métrica sem denominador ou não informada pela Meta; 'zero_confirmed' é zero informado pela coleta.");
  limitations.push("attributedCost só existe quando o investimento pode ser atribuído com segurança ao tipo de resultado; referenceCostPerEvent é investimento total ÷ volume do evento e não é custo atribuído. O custo nativo da Meta não está disponível.");
  const noData = ordered.filter(item => !hasData(item.row.values)).length;
  if (noData) limitations.push(`${noData} entidade(s) sem dado confirmado no período; ausência de dado não é zero.`);
  for (const warning of data.warnings.slice(0, 3)) limitations.push(cleanName(warning).slice(0, 300));

  const peerLevel: CampaignRow["level"] | null = target.level === "client" || target.level === "account" ? "campaign" : target.level === "campaign" ? "adset" : target.level === "adset" ? "ad" : null;
  const make = (entities: EntityFact[], truncated: number): AssistantFacts => {
    const { derived, notes } = buildDerived(entities, peerLevel, truncated ? Number.POSITIVE_INFINITY : peersAvailable);
    const extra = truncated ? [`Foram incluídas ${entities.length} de ${available} entidades (limite de tamanho); não conclua sobre as demais.`] : [];
    return {
      version: FACTS_VERSION, generatedAt: new Date(now).toISOString(),
      scope: { level: target.level, client: cleanName(input.clientName), accounts: consideredAccounts.map(account => ({ name: cleanName(account.name), currency: account.currency })), entity: targetRow ? { level: targetRow.level, id: targetRow.id, name: cleanName(targetRow.name) } : null },
      period: { dateFrom: data.dateFrom, dateTo: data.dateTo },
      source: { metrics: "Meta Ads (coleta confirmada da Groow Ads)", collectedAt: data.latestCollectedAt, metricsAgeHours: metricsAge == null ? null : Math.round(metricsAge * 10) / 10,
        live: { state: data.live.state, checkedAt: data.live.checkedAt, cached: !!data.live.cached, accountsRead: data.live.accountsRead, accountsTotal: data.live.accountsTotal } },
      currencies: [...new Set(entities.map(item => item.currency))].sort(),
      counts: { included: entities.length, available, truncated }, intents, entities, derived,
      limitations: [...limitations, ...notes, ...extra],
    };
  };
  let entities = build(selected);
  let facts = make(entities, available - entities.length);
  // Limite de tamanho: reduz as entidades menos prioritárias até caber, sempre preservando o alvo e declarando o corte.
  while (JSON.stringify(facts).length > FACT_LIMITS.maxChars && selected.length > 1) {
    selected = selected.slice(0, Math.max(1, Math.floor(selected.length * 0.75)));
    entities = build(selected);
    facts = make(entities, available - entities.length);
  }
  return facts;
}
