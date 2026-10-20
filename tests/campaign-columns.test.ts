import { describe, expect, it } from "vitest";
import { buildColumns, buildCostIndex, columnValue, DEFAULT_COLUMN_KEYS, deliveryTier, eventCost, priorityValue, resultFamilies, resultState, sortValue, unavailableReason } from "@/modules/campaigns/columns";
import type { CampaignRow } from "@/modules/campaigns/tree";

const LEAD = "result:provider:action:lead";
const MSG = "result:provider:action:onsite_conversion.messaging_conversation_started_7d";
const vals = (spend: number | null, results: Record<string, number>) => ({ spend, "result:provider_known": 1, ...results });
const row = (level: CampaignRow["level"], id: string, parentId: string | null, values: Record<string, number | null>): CampaignRow => ({
  key: `${level}:${id}`, id, level, name: id, parentId, campaignId: level === "campaign" ? id : "c1", accountId: "acc", accountName: "Conta", currency: "BRL", values,
} as CampaignRow);
const metric = (key: string) => ({ key, label: key, unit: "currency" as const, precision: 2, desirable: "down" as const });

describe("custo por resultado: um tipo", () => {
  const single = row("campaign", "c1", null, vals(100, { [LEAD]: 20 }));
  const index = buildCostIndex([single]);
  it("atribui investimento ÷ resultados da própria entidade", () => {
    expect(columnValue(single, "cost:leads", index)).toBe(5);
    expect(columnValue(single, "event:leads", index)).toBe(5);
    expect(columnValue(single, "result:leads", index)).toBe(20);
  });
  it("tipo que a entidade não registra não ganha custo", () => {
    expect(columnValue(single, "cost:messages", index)).toBeNull();
    expect(columnValue(single, "event:messages", index)).toBeNull();
  });
});

describe("custo por resultado: vários tipos (R$ 300, 10 leads, 30 conversas)", () => {
  const campaign = row("campaign", "c1", null, vals(300, { [LEAD]: 10, [MSG]: 30 }));
  it("mostra os dois resultados separados e a referência investimento ÷ evento sem chamá-la de atribuída", () => {
    const index = buildCostIndex([campaign]);
    expect(columnValue(campaign, "result:leads", index)).toBe(10);
    expect(columnValue(campaign, "result:messages", index)).toBe(30);
    expect(eventCost(campaign.values, "leads")).toBe(30);
    expect(eventCost(campaign.values, "messages")).toBe(10);
    // Sem detalhamento dos filhos não há como repartir o investimento: custo atribuído indisponível, com explicação.
    expect(columnValue(campaign, "cost:leads", index)).toBeNull();
    expect(columnValue(campaign, "cost:messages", index)).toBeNull();
    expect(unavailableReason(campaign, "cost:leads")).toContain("compartilhado");
  });
  it("atribui por tipo quando os conjuntos (um tipo cada) conferem com o total da campanha", () => {
    const rows = [campaign, row("adset", "a", "c1", vals(100, { [LEAD]: 10 })), row("adset", "b", "c1", vals(200, { [MSG]: 30 }))];
    const index = buildCostIndex(rows);
    expect(columnValue(campaign, "cost:leads", index)).toBe(10);
    expect(columnValue(campaign, "cost:messages", index)).toBeCloseTo(200 / 30, 10);
    // O custo atribuído nunca contradiz a referência: aqui são conceitos diferentes e ambos aparecem.
    expect(eventCost(campaign.values, "leads")).toBe(30);
  });
});

describe("custo por resultado: dados incompletos", () => {
  const campaign = row("campaign", "c1", null, vals(300, { [LEAD]: 10, [MSG]: 30 }));
  it("filho sem dado confirmado impede a atribuição quando a soma não confere", () => {
    const rows = [campaign, row("adset", "a", "c1", vals(100, { [LEAD]: 10 })), row("adset", "b", "c1", {})];
    const index = buildCostIndex(rows);
    expect(columnValue(campaign, "cost:leads", index)).toBeNull();
    expect(columnValue(campaign, "cost:messages", index)).toBeNull();
  });
  it("filho sem dado não atrapalha quando os demais conferem com o total (nada foi presumido)", () => {
    const solo = row("campaign", "c1", null, vals(100, { [LEAD]: 10, [MSG]: 0 }));
    const rows = [solo, row("adset", "a", "c1", vals(100, { [LEAD]: 10 })), row("adset", "z", "c1", {})];
    expect(columnValue(solo, "cost:leads", buildCostIndex(rows))).toBe(10);
  });
  it("entidade sem linha confirmada fica sem valores, e a explicação diferencia ausência de zero", () => {
    const missing = row("adset", "m", "c1", {});
    const index = buildCostIndex([missing]);
    expect(columnValue(missing, "spend", index)).toBeNull();
    expect(columnValue(missing, "result:leads", index)).toBeNull();
    expect(unavailableReason(missing, "spend")).toContain("não é o mesmo que zero");
    const zero = row("adset", "z", "c1", { spend: 0, "result:provider_known": 1 });
    expect(columnValue(zero, "spend", index)).toBe(0);
    expect(unavailableReason(zero, "cpc_link")).toContain("indisponível");
  });
  it("investimento ausente ou volume zero não geram custo", () => {
    expect(eventCost(vals(null, { [LEAD]: 5 }), "leads")).toBeNull();
    expect(eventCost(vals(50, { [LEAD]: 0 }), "leads")).toBeNull();
    const noSpend = row("campaign", "c1", null, vals(null, { [LEAD]: 5 }));
    expect(columnValue(noSpend, "cost:leads", buildCostIndex([noSpend]))).toBeNull();
  });
});

describe("catálogo de colunas", () => {
  it("lista os tipos presentes sem escolher principal e oferece resultado, custo atribuído e referência por tipo", () => {
    const families = resultFamilies([{ values: vals(100, { [LEAD]: 20 }) }, { values: vals(300, { [LEAD]: 10, [MSG]: 30 }) }]);
    expect(families.map(item => item.key).sort()).toEqual(["leads", "messages"]);
    const keys = buildColumns([metric("spend"), metric("impressions")], [{ key: "leads", label: "Leads" }]).map(column => column.key);
    expect(keys).toEqual(["spend", "results", "cost_result", "impressions", "result:leads", "cost:leads", "event:leads"]);
  });
});

describe("zero confirmado, ausência e métrica indisponível (resultados)", () => {
  it("diferencia as quatro situações conforme o contrato de coleta", () => {
    expect(resultState({})).toBe("none");
    expect(resultState({ spend: 10 })).toBe("unknown");
    expect(resultState({ spend: 10, "result:provider_known": 0 })).toBe("unknown");
    expect(resultState({ spend: 10, "result:provider_known": 1 })).toBe("zero");
    expect(resultState({ spend: 10, "result:provider_known": 1, [LEAD]: 0 })).toBe("zero");
    expect(resultState({ spend: 10, "result:provider_known": 1, [LEAD]: 3 })).toBe("some");
  });
  it("explica cada situação em vez de usar sempre o mesmo traço", () => {
    const entity = (values: Record<string, number | null>) => row("campaign", "c", null, values);
    expect(unavailableReason(entity({}), "results")).toContain("não é o mesmo que zero");
    expect(unavailableReason(entity({ spend: 10 }), "results")).toContain("não informou");
    expect(unavailableReason(entity({ spend: 10, "result:provider_known": 1 }), "results")).toContain("Zero confirmado");
    expect(unavailableReason(entity({ spend: 10, "result:provider_known": 1 }), "cost_result")).toContain("não se aplica");
  });
});

describe("ordem padrão, colunas padrão e ordenação de resultados", () => {
  const state = (group: string, restrictions: string[], configured: string | null, createdAt: string | null) => ({
    group, restrictions: restrictions.map(key => ({ key, label: key, detail: "" })), configured: configured ? { code: configured, label: configured } : null, createdAt,
  }) as unknown as CampaignRow["state"];
  it("colunas padrão: Valor usado, Resultados, Custo por resultado, Alcance e Impressões", () => {
    expect(DEFAULT_COLUMN_KEYS).toEqual(["spend", "results", "cost_result", "reach", "impressions"]);
  });
  it("prioridade: em veiculação, depois ativas, depois as demais; dentro do grupo, mais recentes primeiro", () => {
    expect(deliveryTier(state("active", [], "ACTIVE", null))).toBe(0);
    expect(deliveryTier(state("active", ["account"], "ACTIVE", null))).toBe(1);
    expect(deliveryTier(state("rejected", [], "ACTIVE", null))).toBe(1);
    expect(deliveryTier(state("paused", [], "PAUSED", null))).toBe(2);
    const values = [
      priorityValue(state("paused", [], "PAUSED", "2026-10-15T00:00:00+0000")),
      priorityValue(state("active", ["account"], "ACTIVE", "2026-01-01T00:00:00+0000")),
      priorityValue(state("active", [], "ACTIVE", "2026-02-01T00:00:00+0000")),
      priorityValue(state("active", [], "ACTIVE", "2026-09-01T00:00:00+0000")),
    ];
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value).map(item => item.index);
    expect(order).toEqual([3, 2, 1, 0]);
  });
  it("Resultados e Custo por resultado ordenam pelo tipo de maior volume, sem somar tipos", () => {
    const campaign = row("campaign", "c1", null, vals(100, { [LEAD]: 10, [MSG]: 30 }));
    const solo = row("campaign", "c2", null, vals(100, { [LEAD]: 20 }));
    const index = buildCostIndex([campaign, solo]);
    expect(sortValue(campaign, "results", index)).toBe(30);
    expect(sortValue(solo, "results", index)).toBe(20);
    expect(sortValue(solo, "cost_result", index)).toBe(5);
    expect(sortValue(row("campaign", "c3", null, {}), "results", index)).toBeNull();
    const columns = buildColumns([metric("spend")], []);
    expect(columns.find(column => column.key === "results")?.sortable).toBe(true);
    expect(columns.find(column => column.key === "cost_result")?.sortable).toBe(true);
  });
});
