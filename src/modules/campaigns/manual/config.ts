import { currencyExponent, formatMinor, type ManualLevel } from "./contracts";

/**
 * Configurações REAIS de uma entidade, lidas sob demanda na Meta e reduzidas a um modelo seguro para a tela: só texto resumido de campos
 * de uma lista permitida (nada de JSON bruto, token ou URL de consulta). Campo ausente não aparece; nunca é preenchido com valor padrão
 * nem deduzido de métricas. Tudo aqui é SOMENTE LEITURA: o que pode ser alterado continua vindo do controle de operações.
 */
export type ConfigItem = { label: string; value: string; note?: string };
export type ConfigSection = { key: "identity" | "delivery" | "budget" | "targeting" | "creative" | "info"; title: string; items: ConfigItem[] };
/** Onde está o orçamento: neste nível (diário ou vitalício) ou não retornado aqui (conjuntos, compartilhado ou indisponível). */
export type BudgetLocation = { kind: "daily" | "lifetime" | "not_at_this_level" | "not_applicable" };
export type EntityConfig = { level: ManualLevel; sections: ConfigSection[]; budgetLocation: BudgetLocation; limitations: string[]; fetchedAt: string };

/** Campos pedidos por nível: lista PERMITIDA (a consulta nunca recebe campo do navegador). Grupos opcionais são lidos separadamente. */
export const CONFIG_FIELDS: Record<ManualLevel, { main: string; groups: { key: string; label: string; fields: string }[] }> = {
  campaign: {
    main: "id,account_id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,bid_strategy,start_time,stop_time,special_ad_categories",
    groups: [],
  },
  adset: {
    main: "id,account_id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,bid_amount,start_time,end_time,destination_type",
    groups: [{ key: "targeting", label: "Segmentação", fields: "targeting" }],
  },
  ad: {
    main: "id,account_id,name,status,effective_status,adset_id,campaign_id",
    groups: [
      { key: "creative", label: "Criativo", fields: "creative{id,name,title,body,call_to_action_type,url_tags,object_story_spec}" },
      { key: "review", label: "Revisão", fields: "ad_review_feedback,issues_info" },
      { key: "tracking", label: "Rastreamento", fields: "tracking_specs" },
    ],
  },
};

const OBJECTIVES: Record<string, string> = {
  OUTCOME_LEADS: "Leads", OUTCOME_SALES: "Vendas", OUTCOME_TRAFFIC: "Tráfego", OUTCOME_ENGAGEMENT: "Engajamento", OUTCOME_AWARENESS: "Reconhecimento", OUTCOME_APP_PROMOTION: "Promoção do aplicativo",
};
const BID_STRATEGIES: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Menor custo (sem limite)", LOWEST_COST_WITH_BID_CAP: "Limite de lance", COST_CAP: "Meta de custo", LOWEST_COST_WITH_MIN_ROAS: "ROAS mínimo",
};
const STATUS_TEXT: Record<string, string> = {
  ACTIVE: "Ativo", PAUSED: "Pausado", ARCHIVED: "Arquivado", DELETED: "Excluído", CAMPAIGN_PAUSED: "Campanha pausada", ADSET_PAUSED: "Conjunto pausado",
  PENDING_REVIEW: "Em análise", DISAPPROVED: "Reprovado", PREAPPROVED: "Pré-aprovado", PENDING_BILLING_INFO: "Pendência de pagamento", IN_PROCESS: "Em processamento", WITH_ISSUES: "Com problemas",
};

const text = (value: unknown, max = 300): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const digits = (value: unknown): number | null => typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const code = (value: unknown, table: Record<string, string> = {}): string | null => { const raw = text(value, 80); return raw ? table[raw] ?? raw : null; };
export function formatMetaTime(value: unknown, timeZone: string | null): string | null {
  const raw = text(value, 40);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timeZone ?? "America/Sao_Paulo" }).format(date); }
  catch { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date); }
}
const push = (items: ConfigItem[], label: string, value: string | null, note?: string) => { if (value) items.push({ label, value, ...(note ? { note } : {}) }); };

/** Resumo da segmentação: só contagens e faixas, nunca a estrutura bruta. Advantage+ muda o que é editável e é declarado quando presente. */
export function summarizeTargeting(raw: unknown): ConfigItem[] {
  const t = obj(raw), items: ConfigItem[] = [];
  const geo = obj(t.geo_locations);
  const places = [["countries", "países"], ["regions", "regiões"], ["cities", "cidades"], ["geo_markets", "mercados"], ["zips", "CEPs"], ["custom_locations", "locais personalizados"]] as const;
  const parts = places.flatMap(([key, label]) => { const n = list(geo[key]).length; return n ? [`${n} ${label}`] : []; });
  push(items, "Localizações", parts.join(", ") || null);
  const min = digits(t.age_min), max = digits(t.age_max);
  if (min !== null || max !== null) push(items, "Idade", `${min ?? "—"} a ${max ?? "—"}${max === 65 ? "+" : ""}`);
  const genders = list(t.genders).filter((g): g is number => typeof g === "number");
  push(items, "Gênero", genders.length ? genders.map(g => g === 1 ? "homens" : g === 2 ? "mulheres" : `código ${g}`).join(", ") : null, genders.length ? undefined : undefined);
  const flexible = list(t.flexible_spec).map(obj);
  const interests = flexible.reduce((sum, spec) => sum + list(spec.interests).length, 0), behaviors = flexible.reduce((sum, spec) => sum + list(spec.behaviors).length, 0);
  push(items, "Interesses e comportamentos", interests || behaviors ? [interests ? `${interests} interesses` : null, behaviors ? `${behaviors} comportamentos` : null].filter(Boolean).join(", ") : null);
  const included = list(t.custom_audiences).length, excluded = list(t.excluded_custom_audiences).length;
  push(items, "Públicos personalizados", included || excluded ? [included ? `${included} incluídos` : null, excluded ? `${excluded} excluídos` : null].filter(Boolean).join(", ") : null);
  const platforms = list(t.publisher_platforms).filter((p): p is string => typeof p === "string").slice(0, 6);
  push(items, "Plataformas", platforms.length ? platforms.join(", ") : "Posicionamentos automáticos (Advantage+)", platforms.length ? "Posicionamentos escolhidos manualmente." : "Sem lista manual retornada pela Meta.");
  const automation = obj(t.targeting_automation);
  if (digits(automation.advantage_audience) === 1) items.push({ label: "Advantage+", value: "Público Advantage+ ativo", note: "A Meta pode expandir o público; nem toda segmentação é editável." });
  return items;
}

/** Revisão do anúncio: motivos como texto curto (códigos/resumos que a Meta devolve), sem inventar causa. */
export function summarizeReview(feedback: unknown, issues: unknown): ConfigItem[] {
  const items: ConfigItem[] = [];
  const reasons: string[] = [];
  for (const entry of Object.values(obj(feedback))) for (const value of Object.values(obj(entry))) { const t = text(value, 160); if (t) reasons.push(t); }
  push(items, "Motivos de revisão", reasons.length ? reasons.slice(0, 5).join(" · ") : null, "Texto devolvido pela Meta.");
  const summaries = list(issues).map(item => text(obj(item).error_summary, 160)).filter((t): t is string => !!t);
  push(items, "Problemas de entrega", summaries.length ? summaries.slice(0, 5).join(" · ") : null);
  return items;
}

/** Texto, título, CTA e destino do criativo (somente leitura: alterar exige NOVO criativo, fluxo ainda não disponível). */
export function summarizeCreative(raw: unknown): ConfigItem[] {
  const c = obj(raw), items: ConfigItem[] = [];
  const spec = obj(c.object_story_spec);
  const link = obj(spec.link_data), video = obj(spec.video_data), photo = obj(spec.photo_data);
  push(items, "Criativo", text(c.name, 120) ?? text(c.id, 40));
  push(items, "Título", text(c.title, 160) ?? text(link.name, 160) ?? text(video.title, 160));
  push(items, "Texto principal", text(c.body, 280) ?? text(link.message, 280) ?? text(video.message, 280) ?? text(photo.message, 280));
  const cta = text(c.call_to_action_type, 60) ?? text(obj(link.call_to_action).type, 60) ?? text(obj(video.call_to_action).type, 60);
  push(items, "Botão (CTA)", cta);
  const destination = text(link.link, 400) ?? text(obj(obj(link.call_to_action).value).link, 400) ?? text(obj(obj(video.call_to_action).value).link, 400);
  push(items, "Destino", destination, "Somente leitura.");
  push(items, "Parâmetros de rastreamento (URL)", text(c.url_tags, 300));
  return items;
}

export type RawConfig = { main: Record<string, unknown>; groups: Record<string, Record<string, unknown> | null>; currency: string; timezone: string | null; failedGroups: string[] };

/** Reduz as respostas da Meta ao modelo da tela. Só entra o que foi retornado; falha de grupo vira limitação explícita. */
export function buildEntityConfig(level: ManualLevel, raw: RawConfig, fetchedAt: string): EntityConfig {
  const m = raw.main, exponent = currencyExponent(raw.currency) ?? 2;
  const money = (value: unknown) => { const minor = digits(value); return minor === null ? null : formatMinor(minor, raw.currency, exponent); };
  const identity: ConfigItem[] = [], delivery: ConfigItem[] = [], budget: ConfigItem[] = [], info: ConfigItem[] = [];
  push(identity, "Nome", text(m.name, 400));
  push(delivery, "Estado configurado", code(m.status, STATUS_TEXT));
  push(delivery, "Estado efetivo", code(m.effective_status, STATUS_TEXT));
  let location: BudgetLocation = { kind: "not_applicable" };
  if (level !== "ad") {
    const daily = digits(m.daily_budget), lifetime = digits(m.lifetime_budget);
    if (daily && daily > 0) { location = { kind: "daily" }; push(budget, "Orçamento diário", money(m.daily_budget)); }
    else if (lifetime && lifetime > 0) { location = { kind: "lifetime" }; push(budget, "Orçamento vitalício", money(m.lifetime_budget), "A edição por aqui altera apenas orçamento diário."); }
    else { location = { kind: "not_at_this_level" }; budget.push({ label: "Orçamento", value: "Não retornado neste nível", note: level === "campaign" ? "Pode estar nos conjuntos de anúncios ou ser compartilhado. Consulte os conjuntos." : "Pode estar definido na campanha." }); }
    if (daily && lifetime && lifetime > 0) push(budget, "Orçamento vitalício", money(m.lifetime_budget));
    push(budget, "Estratégia de lance", code(m.bid_strategy, BID_STRATEGIES));
    if (level === "adset") push(budget, "Valor de lance", money(m.bid_amount));
  }
  push(delivery, level === "adset" ? "Início" : "Início", formatMetaTime(m.start_time, raw.timezone));
  push(delivery, level === "adset" ? "Término" : "Término", formatMetaTime(m.end_time ?? m.stop_time, raw.timezone));
  if (level === "campaign") {
    push(info, "Objetivo", code(m.objective, OBJECTIVES), "O objetivo não pode ser trocado depois de criada a campanha por aqui.");
    push(info, "Tipo de compra", code(m.buying_type, { AUCTION: "Leilão", RESERVED: "Reservado" }));
    const categories = list(m.special_ad_categories).filter((c): c is string => typeof c === "string" && c !== "NONE");
    push(info, "Categorias especiais", categories.length ? categories.join(", ") : null);
  }
  if (level === "adset") {
    push(info, "Objetivo de otimização", code(m.optimization_goal));
    push(info, "Evento de cobrança", code(m.billing_event));
    push(info, "Destino", code(m.destination_type));
  }
  const sections: ConfigSection[] = [];
  const add = (key: ConfigSection["key"], title: string, items: ConfigItem[]) => { if (items.length) sections.push({ key, title, items }); };
  add("identity", "Identificação", identity); add("delivery", "Veiculação", delivery); add("budget", "Orçamento", budget);
  // Grupo que a Meta não devolveu NÃO vira "vazio" (nem "automático"): some e entra nas limitações.
  if (level === "adset" && raw.groups.targeting) add("targeting", "Segmentação", summarizeTargeting(raw.groups.targeting.targeting));
  if (level === "ad") {
    if (raw.groups.creative) add("creative", "Criativo", summarizeCreative(raw.groups.creative.creative));
    const review = raw.groups.review ? summarizeReview(raw.groups.review.ad_review_feedback, raw.groups.review.issues_info) : [];
    const tracking = list(raw.groups.tracking?.tracking_specs).length;
    if (tracking) review.push({ label: "Rastreamento", value: `${tracking} especificações de evento`, note: "Somente leitura." });
    add("info", "Revisão e rastreamento", review);
  }
  add("info", "Informações", info);
  const names = { targeting: "segmentação", creative: "criativo", review: "revisão", tracking: "rastreamento" } as const;
  return { level, sections, budgetLocation: location, fetchedAt,
    limitations: raw.failedGroups.map(key => `${names[key as keyof typeof names] ?? key}: a Meta não devolveu estes dados agora.`) };
}
