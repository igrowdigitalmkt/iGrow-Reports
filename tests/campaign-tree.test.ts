import { describe, expect, it } from "vitest";
import { classifyDelivery } from "@/modules/campaigns/delivery-state";
import { filterCampaignRows, sortRows, type CampaignRow } from "@/modules/campaigns/tree";

const row = (level: CampaignRow["level"], id: string, name: string, parentId: string | null, status: string, spend: number | null): CampaignRow => ({
  key: `${level}:${id}`, id, level, name, parentId, campaignId: level === "campaign" ? id : "c1", accountId: "acc", accountName: "Conta", currency: "BRL",
  values: { spend }, state: classifyDelivery({ configured: null, status, issues: false, accountBlocked: false }),
});
const rows = [
  row("campaign", "c1", "Captação São Paulo", null, "ACTIVE", 100),
  row("adset", "s1", "Público aberto", "c1", "PAUSED", 40),
  row("ad", "a1", "Vídeo institucional", "s1", "DISAPPROVED", 10),
  row("campaign", "c2", "Remarketing", null, "PAUSED", 20),
];

describe("filterCampaignRows", () => {
  it("sem filtros devolve tudo", () => expect(filterCampaignRows(rows, { query: "", group: "all" }).rows).toHaveLength(4));
  it("busca ignora acentos e maiúsculas, mantém filhos da campanha encontrada e revela o caminho", () => {
    const result = filterCampaignRows(rows, { query: "captacao", group: "all" });
    expect(result.rows.map(r => r.id)).toEqual(["c1", "s1", "a1"]);
  });
  it("busca por anúncio mantém seus ancestrais e abre o caminho", () => {
    const result = filterCampaignRows(rows, { query: "vídeo", group: "all" });
    expect(result.rows.map(r => r.id)).toEqual(["c1", "s1", "a1"]);
    expect([...result.reveal].sort()).toEqual(["adset:s1", "campaign:c1"]);
  });
  it("filtro de estado avalia cada nível e preserva ancestrais", () => {
    expect(filterCampaignRows(rows, { query: "", group: "rejected" }).rows.map(r => r.id)).toEqual(["c1", "s1", "a1"]);
    expect(filterCampaignRows(rows, { query: "", group: "paused" }).rows.map(r => r.id)).toEqual(["c1", "s1", "c2"]);
    expect(filterCampaignRows(rows, { query: "", group: "unavailable" }).rows).toHaveLength(0);
  });
});

describe("sortRows", () => {
  it("ordena por métrica com ausentes por último e por nome", () => {
    const list = [rows[0]!, rows[3]!, { ...rows[3]!, id: "c3", name: "Sem dado", values: { spend: null } }];
    expect(sortRows(list, { key: "spend", direction: "desc" }).map(r => r.id)).toEqual(["c1", "c2", "c3"]);
    expect(sortRows(list, { key: "name", direction: "asc" }).map(r => r.name)).toEqual(["Captação São Paulo", "Remarketing", "Sem dado"]);
  });
});
