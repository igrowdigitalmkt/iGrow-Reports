import { describe, expect, it } from "vitest";
import { buildAssistantFacts, detectIntents, FACT_LIMITS } from "@/modules/campaigns/assistant/server/facts";
import type { AssistantTarget } from "@/modules/campaigns/assistant/request";
import { campaignsData, IDS, LEAD, row, vals } from "./campaign-assistant-fixtures";

const NOW = Date.parse("2026-10-19T15:00:00Z");
const ALL = { level: "client" as const, accountIds: [IDS.accA, IDS.accB] };
const facts = (target: AssistantTarget, over = {}, question = "Analise o desempenho.") => buildAssistantFacts({ data: campaignsData(over), target, clientName: "Colégio Exemplo", question, now: NOW });
const ids = (f: ReturnType<typeof facts>) => f.entities.map(e => `${e.ref.level}:${e.ref.id}@${e.accountId === IDS.accA ? "A" : "B"}`);

describe("fatos por contexto: só o necessário", () => {
  it("anúncio: o próprio anúncio, o conjunto e a campanha, sem a carteira", () => {
    const f = facts({ level: "ad", accountId: IDS.accA, entityId: "300" });
    expect(ids(f)).toEqual(["ad:300@A", "adset:200@A", "campaign:100@A"]);
    expect(f.entities.map(e => e.role)).toEqual(["target", "parent", "parent"]);
    expect(f.counts).toEqual({ included: 3, available: 3, truncated: 0 });
  });
  it("conjunto: o conjunto, a campanha e os anúncios", () => {
    expect(ids(facts({ level: "adset", accountId: IDS.accA, entityId: "200" }))).toEqual(["adset:200@A", "campaign:100@A", "ad:300@A"]);
  });
  it("campanha: a campanha com conjuntos e anúncios; a campanha homônima de outra conta fica de fora", () => {
    const f = facts({ level: "campaign", accountId: IDS.accA, entityId: "100" });
    expect(ids(f)).toEqual(["campaign:100@A", "adset:201@A", "adset:200@A", "ad:300@A"]);
    expect(f.entities.some(e => e.accountId === IDS.accB)).toBe(false);
  });
  it("conta: apenas campanhas daquela conta; cliente: campanhas de todas as contas", () => {
    expect(ids(facts({ level: "account", accountId: IDS.accB }))).toEqual(["campaign:100@B"]);
    expect(ids(facts(ALL))).toEqual(["campaign:100@A", "campaign:100@B", "campaign:400@A"]);
  });
});

describe("confiabilidade: ausência não vira zero", () => {
  it("diferencia confirmado, zero confirmado, indisponível e ausente", () => {
    const rows = [
      row("campaign", "1", "Com dados", null, IDS.accA, { ...vals(0, {}), cpc_link: null }),
      row("campaign", "2", "Sem linha", null, IDS.accA, {}),
    ];
    const f = facts({ level: "account", accountId: IDS.accA }, { rows });
    const withData = f.entities.find(e => e.ref.id === "1")!;
    expect(withData.metrics.find(m => m.key === "spend")).toMatchObject({ value: 0, status: "zero_confirmed" });
    expect(withData.metrics.find(m => m.key === "cpc_link")).toMatchObject({ value: null, status: "unavailable" });
    expect(withData.resultsStatus).toBe("zero_confirmed");
    const absent = f.entities.find(e => e.ref.id === "2")!;
    expect(absent.metrics.every(m => m.value === null && m.status === "absent")).toBe(true);
    expect(absent.resultsStatus).toBe("absent");
    expect(absent.results).toEqual([]);
    expect(f.limitations.join(" ")).toContain("sem dado confirmado");
  });
  it("resultados por tipo trazem custo atribuído e referência separados", () => {
    const f = facts({ level: "campaign", accountId: IDS.accA, entityId: "100" });
    const campaign = f.entities[0]!;
    expect(campaign.results.map(r => r.type).sort()).toEqual(["Conversas por mensagem iniciadas", "Leads"]);
    const lead = campaign.results.find(r => r.type === "Leads")!;
    // Conjuntos de um tipo cada e que conferem com o total: custo atribuído existe; a referência usa o investimento total.
    expect(lead).toMatchObject({ value: 10, attributedCost: 10, referenceCostPerEvent: 30 });
    const single = f.entities.find(e => e.ref.id === "200")!;
    expect(single.results[0]).toMatchObject({ attributedCost: 10, referenceCostPerEvent: 10 });
    // Sem os conjuntos, nada é atribuído, mas a referência continua separada e nomeada.
    const alone = facts(ALL, { rows: [row("campaign", "100", "Captação", null, IDS.accA, vals(300, { [LEAD]: 10, "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 30 }))] }).entities[0]!;
    expect(alone.results.map(r => r.attributedCost)).toEqual([null, null]);
    expect(alone.results.every(r => r.referenceCostPerEvent != null)).toBe(true);
  });
  it("estado atual indisponível, parcial ou reaproveitado vira limitação e nunca estado confirmado", () => {
    const off = facts(ALL, { live: { state: "unavailable", checkedAt: null, accountsRead: 0, accountsTotal: 2, cached: false } });
    expect(off.source.live.state).toBe("unavailable");
    expect(off.entities.every(e => e.delivery.source === "unavailable")).toBe(true);
    expect(off.limitations.join(" ")).toContain("não afirme o estado atual");
    const partial = facts(ALL, { live: { state: "partial", checkedAt: "2026-10-19T14:00:00Z", accountsRead: 1, accountsTotal: 2, cached: false } });
    expect(partial.limitations.join(" ")).toContain("1 de 2 contas");
    const cached = facts(ALL, { live: { state: "ok", checkedAt: "2026-10-19T14:59:00Z", accountsRead: 2, accountsTotal: 2, cached: true } });
    expect(cached.entities[0]!.delivery.source).toBe("live_cached");
    expect(cached.limitations.join(" ")).toContain("reaproveitada");
  });
  it("informa idade da coleta e métricas desatualizadas; restrições não escondem o estado original", () => {
    const fresh = facts(ALL);
    expect(fresh.source).toMatchObject({ collectedAt: "2026-10-19T12:00:00Z", metricsAgeHours: 3 });
    expect(fresh.limitations.join(" ")).not.toContain("desatualizadas");
    const stale = facts(ALL, { latestCollectedAt: "2026-10-17T12:00:00Z" });
    expect(stale.limitations.join(" ")).toContain("desatualizadas");
    const unknown = facts(ALL, { latestCollectedAt: null });
    expect(unknown.source.metricsAgeHours).toBeNull();
    const paused = facts({ level: "campaign", accountId: IDS.accA, entityId: "400" }).entities[0]!;
    expect(paused.delivery).toMatchObject({ label: "Pausado", effective: "PAUSED", restrictions: ["Conta sem veiculação"] });
  });
  it("carrega período, fonte, moeda, escopo e limitações produzidos pelo servidor", () => {
    const f = facts({ level: "account", accountId: IDS.accA });
    expect(f).toMatchObject({ version: 2, period: { dateFrom: "2026-09-19", dateTo: "2026-10-18" }, currencies: ["BRL"], scope: { level: "account", client: "Colégio Exemplo", accounts: [{ name: "Conta A", currency: "BRL" }] } });
    expect(f.source.metrics).toContain("Meta Ads");
    expect(f.limitations.join(" ")).toContain("consultiva");
  });
});

describe("limites de volume e prioridade pela pergunta", () => {
  const many = Array.from({ length: 120 }, (_, i) => row("campaign", String(1000 + i), `Campanha ${i}`, null, IDS.accA, vals(i + 1, { [LEAD]: i })));
  it("não envia centenas de entidades: corta no limite, prioriza o maior investimento e declara o corte", () => {
    const f = facts(ALL, { rows: many });
    expect(f.entities.length).toBeLessThanOrEqual(FACT_LIMITS.maxEntities);
    expect(f.counts).toMatchObject({ available: 120, truncated: 120 - f.entities.length });
    expect(f.entities[0]!.ref.id).toBe("1119");
    expect(f.limitations.join(" ")).toContain("limite de tamanho");
    expect(JSON.stringify(f).length).toBeLessThanOrEqual(FACT_LIMITS.maxChars);
  });
  it("nomes enormes não estouram o tamanho total: reduz mais entidades e preserva o alvo", () => {
    const huge = Array.from({ length: 60 }, (_, i) => row("campaign", String(2000 + i), `${"N".repeat(900)} ${i}`, null, IDS.accA, vals(i + 1, { [LEAD]: 1 })));
    const f = facts(ALL, { rows: huge });
    expect(JSON.stringify(f).length).toBeLessThanOrEqual(FACT_LIMITS.maxChars);
    expect(f.counts.truncated).toBeGreaterThan(0);
    expect(f.entities.length).toBeGreaterThanOrEqual(1);
  });
  it("pergunta sobre entrega traz só o investimento como métrica; desempenho traz o conjunto completo", () => {
    expect(detectIntents("Por que este anúncio não está entregando?")).toEqual(["delivery"]);
    expect(detectIntents("Qual campanha teve mais resultados?")).toEqual(expect.arrayContaining(["ranking", "performance"]));
    expect(detectIntents("Compare os conjuntos desta campanha.")).toContain("compare");
    expect(detectIntents("Qual foi o investimento deste conjunto?")).toContain("spend");
    expect(detectIntents("bom dia")).toEqual(["performance"]);
    const delivery = facts({ level: "ad", accountId: IDS.accA, entityId: "300" }, {}, "Por que este anúncio não está entregando?");
    expect(delivery.entities[0]!.metrics.map(m => m.key)).toEqual(["spend"]);
    const performance = facts({ level: "ad", accountId: IDS.accA, entityId: "300" }, {}, "Analise o desempenho deste anúncio.");
    expect(performance.entities[0]!.metrics.length).toBeGreaterThan(1);
  });
});
