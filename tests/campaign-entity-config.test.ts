import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/agent-executor/manual-actions", () => ({ requestManualMetaChange: vi.fn() }));
vi.mock("@/modules/agent-executor/scheduler", () => ({ agentSchedulerEnabled: () => true }));
vi.mock("@/modules/meta/server", () => ({ loadAccessToken: vi.fn(async () => "SEGREDO-TOKEN") }));

import { CONFIG_FIELDS, buildEntityConfig, formatMetaTime, summarizeCreative, summarizeReview, summarizeTargeting, type RawConfig } from "@/modules/campaigns/manual/config";
import { loadEntityConfig, type ConfigDeps } from "@/modules/campaigns/manual/control";

const AGENCY = "00000000-0000-4000-8000-0000000000a1", CLIENT = "00000000-0000-4000-8000-0000000000c1", ACCOUNT = "00000000-0000-4000-8000-0000000000b1";
const owner = { agencyId: AGENCY, userId: "u1", role: "owner" };
const campaignRef = { clientId: CLIENT, accountId: ACCOUNT, level: "campaign" as const, entityId: "900" };

function fakeService(over: Record<string, unknown> = {}) {
  const tables: Record<string, unknown> = {
    clients: { id: CLIENT }, client_ad_accounts: { active: true },
    meta_ad_accounts: { id: ACCOUNT, external_id: "act_1", name: "Conta 1", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: "1", meta_connection_id: "mc" },
    meta_connections: { id: "mc", integration_id: "in", scopes: ["ads_read"], connected_at: "2026-10-01T00:00:00Z" },
    integrations: { id: "in", connection_status: "connected", health_status: "ok" }, ...over,
  };
  const chain = (table: string) => { const v = tables[table]; const c: Record<string, unknown> = {};
    for (const m of ["select", "is", "in", "order", "limit", "eq"]) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve({ data: v ?? null, error: null });
    return c; };
  return { from: chain, rpc: async () => ({ data: true, error: null }) } as never;
}
const raw = (main: Record<string, unknown>, groups: RawConfig["groups"] = {}, failed: string[] = []): RawConfig => ({ main, groups, currency: "BRL", timezone: "America/Sao_Paulo", failedGroups: failed });
const labels = (config: ReturnType<typeof buildEntityConfig>) => config.sections.flatMap(section => section.items.map(item => `${item.label}=${item.value}`));
const at = "2026-10-21T12:00:00Z";

describe("mapeamento das configurações reais", () => {
  it("campanha: objetivo, estado, orçamento diário confirmado (moeda da conta), lance e programação no fuso da conta", () => {
    const config = buildEntityConfig("campaign", raw({ id: "900", name: "Captação", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_LEADS", buying_type: "AUCTION", daily_budget: "15000",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP", start_time: "2026-10-01T03:00:00+0000", stop_time: "2026-11-01T03:00:00+0000", special_ad_categories: ["NONE"] }), at);
    expect(config.budgetLocation).toEqual({ kind: "daily" });
    const l = labels(config);
    expect(l).toEqual(expect.arrayContaining(["Nome=Captação", "Estado configurado=Ativo", "Estado efetivo=Ativo", "Objetivo=Leads", "Tipo de compra=Leilão", "Estratégia de lance=Menor custo (sem limite)"]));
    expect(l.find(item => item.startsWith("Orçamento diário="))).toMatch(/150,00/);
    expect(l.find(item => item.startsWith("Início="))).toMatch(/01\/10\/2026.*00:00/);
    expect(l.join("|")).not.toContain("Categorias especiais");
  });
  it("campanha sem orçamento neste nível: declara onde pode estar, sem inventar valor nem zero", () => {
    const config = buildEntityConfig("campaign", raw({ id: "900", name: "CBO nos conjuntos", status: "PAUSED", objective: "OUTCOME_SALES" }), at);
    expect(config.budgetLocation).toEqual({ kind: "not_at_this_level" });
    const budget = config.sections.find(section => section.key === "budget")!;
    expect(budget.items[0]).toMatchObject({ label: "Orçamento", value: "Não retornado neste nível" });
    expect(budget.items[0]!.note).toMatch(/conjuntos/);
    expect(labels(config).join("|")).not.toMatch(/R\$ 0|0,00/);
  });
  it("orçamento vitalício é reconhecido e a edição é declarada como só diária; zero não vira orçamento", () => {
    const lifetime = buildEntityConfig("campaign", raw({ id: "900", name: "Vit", status: "ACTIVE", daily_budget: "0", lifetime_budget: "500000" }), at);
    expect(lifetime.budgetLocation).toEqual({ kind: "lifetime" });
    expect(lifetime.sections.find(section => section.key === "budget")!.items[0]!.note).toMatch(/apenas orçamento diário/);
  });
  it("conjunto: otimização, cobrança, lance, destino e segmentação resumida (sem estrutura bruta)", () => {
    const config = buildEntityConfig("adset", raw({ id: "910", name: "Conj", status: "ACTIVE", campaign_id: "900", daily_budget: "5000", optimization_goal: "LEAD_GENERATION", billing_event: "IMPRESSIONS", bid_strategy: "COST_CAP", bid_amount: "1200", destination_type: "WEBSITE", end_time: "2026-12-01T03:00:00+0000" },
      { targeting: { targeting: { geo_locations: { countries: ["BR"], cities: [{ key: "1" }, { key: "2" }] }, age_min: 25, age_max: 65, genders: [2], flexible_spec: [{ interests: [{ id: "1" }, { id: "2" }], behaviors: [{ id: "3" }] }],
        custom_audiences: [{ id: "a" }], excluded_custom_audiences: [{ id: "b" }, { id: "c" }], publisher_platforms: ["facebook", "instagram"], targeting_automation: { advantage_audience: 1 } } } }), at);
    const l = labels(config);
    expect(l).toEqual(expect.arrayContaining(["Objetivo de otimização=LEAD_GENERATION", "Evento de cobrança=IMPRESSIONS", "Estratégia de lance=Meta de custo", "Destino=WEBSITE",
      "Localizações=1 países, 2 cidades", "Idade=25 a 65+", "Gênero=mulheres", "Interesses e comportamentos=2 interesses, 1 comportamentos", "Públicos personalizados=1 incluídos, 2 excluídos", "Plataformas=facebook, instagram", "Advantage+=Público Advantage+ ativo"]));
    expect(l.find(item => item.startsWith("Valor de lance="))).toMatch(/12,00/);
    expect(JSON.stringify(config)).not.toContain("flexible_spec");
  });
  it("segmentação sem lista manual de plataformas é descrita como automática, não como vazia", () => {
    const items = summarizeTargeting({ geo_locations: { countries: ["BR"] } });
    expect(items.find(item => item.label === "Plataformas")).toMatchObject({ value: expect.stringMatching(/automáticos/) });
    expect(summarizeTargeting(null).find(item => item.label === "Localizações")).toBeUndefined();
  });
  it("anúncio: criativo (título, texto, CTA, destino, rastreamento), revisão e rastreamento; nada de orçamento", () => {
    const creative = { creative: { id: "c1", name: "Criativo A", url_tags: "utm_source=meta", call_to_action_type: "LEARN_MORE", object_story_spec: { link_data: { link: "https://exemplo.com/oferta", message: "Texto principal do anúncio", name: "Título do anúncio" } } } };
    const config = buildEntityConfig("ad", raw({ id: "920", name: "Anúncio", status: "PAUSED", effective_status: "DISAPPROVED", adset_id: "910" },
      { creative, review: { ad_review_feedback: { global: { "Texto não permitido": "Promessas exageradas" } }, issues_info: [{ error_summary: "Anúncio reprovado" }] }, tracking: { tracking_specs: [{ "action.type": ["offsite_conversion"] }] } }), at);
    expect(config.budgetLocation).toEqual({ kind: "not_applicable" });
    const l = labels(config);
    expect(l).toEqual(expect.arrayContaining(["Título=Título do anúncio", "Texto principal=Texto principal do anúncio", "Botão (CTA)=LEARN_MORE", "Destino=https://exemplo.com/oferta", "Parâmetros de rastreamento (URL)=utm_source=meta",
      "Estado efetivo=Reprovado", "Motivos de revisão=Promessas exageradas", "Problemas de entrega=Anúncio reprovado", "Rastreamento=1 especificações de evento"]));
    expect(l.join("|")).not.toMatch(/Orçamento/);
  });
  it("grupo opcional indisponível vira limitação explícita; o restante continua", () => {
    const config = buildEntityConfig("adset", raw({ id: "910", name: "Conj", status: "ACTIVE", daily_budget: "5000" }, { targeting: null }, ["targeting"]), at);
    expect(config.limitations).toEqual(["segmentação: a Meta não devolveu estes dados agora."]);
    expect(config.sections.some(section => section.key === "targeting")).toBe(false);
    expect(config.sections.some(section => section.key === "budget")).toBe(true);
  });
  it("resumos tolerantes a dados malformados e limitados em tamanho", () => {
    expect(summarizeCreative("lixo")).toEqual([]);
    expect(summarizeReview([], "x")).toEqual([]);
    const long = summarizeCreative({ creative: {}, body: "x".repeat(900) });
    expect(long.every(item => item.value.length <= 400)).toBe(true);
    expect(summarizeCreative({ body: "y".repeat(900) })[0]!.value.length).toBeLessThanOrEqual(280);
    expect(formatMetaTime("data inválida", null)).toBeNull();
    expect(formatMetaTime(undefined, null)).toBeNull();
    expect(formatMetaTime("2026-10-01T03:00:00+0000", "Fuso/Invalido")).toMatch(/01\/10\/2026/);
  });
  it("lista de campos é fixa por nível (a consulta nunca recebe campo do navegador)", () => {
    expect(CONFIG_FIELDS.campaign.main).toContain("objective");
    expect(CONFIG_FIELDS.ad.groups.map(group => group.key)).toEqual(["creative", "review", "tracking"]);
    for (const level of ["campaign", "adset", "ad"] as const) expect(CONFIG_FIELDS[level].main).not.toMatch(/access_token|secret/);
  });
});

describe("leitura das configurações (servidor)", () => {
  const reader = (map: Record<string, Record<string, unknown> | "fail">) => vi.fn(async (_s: unknown, _scope: unknown, _id: string, fields: string) => {
    const hit = Object.entries(map).find(([key]) => fields.includes(key));
    const value = hit?.[1];
    if (value === "fail") throw new Error("meta");
    return (value as Record<string, unknown> | undefined) ?? null;
  });
  const deps = (readConfig: ConfigDeps["readConfig"], tables: Record<string, unknown> = {}): ConfigDeps => ({ service: fakeService(tables), readConfig, now: () => new Date(at) } as never);

  it("owner/admin leem; membro e papéis sem permissão não consultam a Meta", async () => {
    const read = reader({ objective: { id: "900", account_id: "act_1", name: "C", status: "ACTIVE", objective: "OUTCOME_LEADS", daily_budget: "100" } });
    expect(await loadEntityConfig(owner, campaignRef, deps(read))).toMatchObject({ ok: true });
    for (const role of ["member", "viewer", "client"]) {
      const r = reader({});
      expect(await loadEntityConfig({ ...owner, role }, campaignRef, deps(r))).toMatchObject({ ok: false, kind: "unauthorized" });
      expect(r).not.toHaveBeenCalled();
    }
  });
  it("é leitura: funciona com conexão só de leitura e conta restrita (não exige ads_management nem conta ativa)", async () => {
    const read = reader({ objective: { id: "900", account_id: "act_1", name: "C", status: "PAUSED", objective: "OUTCOME_LEADS" } });
    const tables = { meta_ad_accounts: { id: ACCOUNT, external_id: "act_1", name: "C", currency: "BRL", timezone_name: null, account_status: "3", meta_connection_id: "mc" } };
    expect(await loadEntityConfig(owner, campaignRef, deps(read, tables))).toMatchObject({ ok: true });
  });
  it("conexão offline, cliente/conta de outra organização e identificadores inválidos são recusados sem leitura", async () => {
    for (const tables of [{ integrations: { id: "in", connection_status: "disconnected", health_status: "ok" } }, { clients: null }, { client_ad_accounts: { active: false } }, { meta_ad_accounts: null }]) {
      const r = reader({});
      expect((await loadEntityConfig(owner, campaignRef, deps(r, tables))).ok).toBe(false);
      expect(r).not.toHaveBeenCalled();
    }
    const r = reader({});
    expect((await loadEntityConfig(owner, { ...campaignRef, entityId: "12a" }, deps(r))).ok).toBe(false);
    expect(r).not.toHaveBeenCalled();
  });
  it("entidade de outra conta da Meta ou id diferente: incompatível; falha da Meta: não confirmado", async () => {
    expect(await loadEntityConfig(owner, campaignRef, deps(reader({ objective: { id: "900", account_id: "act_999", name: "C" } })))).toMatchObject({ ok: false, kind: "incompatible" });
    expect(await loadEntityConfig(owner, campaignRef, deps(reader({ objective: { id: "901", account_id: "act_1" } })))).toMatchObject({ ok: false, kind: "incompatible" });
    expect(await loadEntityConfig(owner, campaignRef, deps(reader({ objective: "fail" })))).toMatchObject({ ok: false, kind: "unknown_state" });
  });
  it("anúncio: um GET principal e um por grupo; a falha de um grupo não derruba os demais", async () => {
    const read = reader({ "id,account_id,name,status,effective_status,adset_id": { id: "920", account_id: "1", name: "Ad", status: "ACTIVE", adset_id: "910" },
      creative: { creative: { id: "c", name: "Cr", body: "Texto" } }, ad_review_feedback: "fail", tracking_specs: { tracking_specs: [] } });
    const result = await loadEntityConfig(owner, { ...campaignRef, level: "ad", entityId: "920" }, deps(read));
    expect(result.ok).toBe(true);
    expect(read).toHaveBeenCalledTimes(4);
    if (result.ok) {
      expect(result.config.limitations).toEqual(["revisão: a Meta não devolveu estes dados agora."]);
      expect(labels(result.config).join("|")).toContain("Texto principal=Texto");
    }
  });
  it("não vaza token nem consulta bruta e só lê (leitor injetado recebe apenas campos da lista)", async () => {
    const read = reader({ objective: { id: "900", account_id: "act_1", name: "C", status: "ACTIVE", objective: "OUTCOME_LEADS" } });
    const result = await loadEntityConfig(owner, campaignRef, deps(read));
    expect(JSON.stringify(result)).not.toMatch(/SEGREDO|access_token|graph\.facebook/);
    expect(read.mock.calls[0]![3]).toBe(CONFIG_FIELDS.campaign.main);
  });
});
