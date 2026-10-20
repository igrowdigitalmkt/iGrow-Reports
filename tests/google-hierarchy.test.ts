import { describe, expect, it } from "vitest";
import { buildGoogleRows } from "@/modules/google-ads/hierarchy";
import { adGroupQuery, adListQuery, adRowsQuery, campaignListQuery, campaignQuery } from "@/modules/google-ads/queries";

const account = { id: "a1", customerId: "1112223333", name: "Conta Google", currency: "BRL", timezone: "America/Sao_Paulo" };
const metrics = (cost: string) => ({ costMicros: cost, impressions: "1000", clicks: "50", conversions: 5 });

describe("hierarquia do Google Ads no formato das linhas de Campanhas", () => {
  const rows = buildGoogleRows(account, {
    campaigns: [{ campaign: { id: "1", name: "Pesquisa", status: "ENABLED", advertisingChannelType: "SEARCH", startDate: "2026-10-01" }, metrics: metrics("100000000") }],
    campaignList: [
      { campaign: { id: "1", name: "Pesquisa", status: "ENABLED", startDate: "2026-10-01" } },
      { campaign: { id: "2", name: "Nova ativa", status: "ENABLED", startDate: "2026-10-20" } },
      { campaign: { id: "3", name: "Pausada", status: "PAUSED", startDate: "2026-08-01" } },
    ],
    adGroups: [{ adGroup: { id: "10", name: "Grupo A", status: "ENABLED" }, campaign: { id: "1" }, metrics: metrics("60000000") }],
    adGroupList: [
      { adGroup: { id: "10", name: "Grupo A", status: "ENABLED" }, campaign: { id: "1" } },
      { adGroup: { id: "30", name: "Grupo da pausada", status: "ENABLED" }, campaign: { id: "3" } },
    ],
    ads: [{ adGroupAd: { status: "ENABLED", ad: { id: "100", responsiveSearchAd: { headlines: [{ text: "Primeiro título" }] } } }, adGroup: { id: "10" }, campaign: { id: "1" }, metrics: metrics("60000000") }],
    adList: [
      { adGroupAd: { status: "PAUSED", ad: { id: "101", name: "Anúncio com nome" } }, adGroup: { id: "10" }, campaign: { id: "1" } },
      { adGroupAd: { status: "ENABLED", ad: { id: "300" } }, adGroup: { id: "30" }, campaign: { id: "3" } },
    ],
  });
  const find = (level: string, id: string) => rows.find(row => row.level === level && row.id === id)!;

  it("campanha sem atividade no período entra com zero confirmado e o estado da lista completa", () => {
    expect(find("campaign", "2").values.spend).toBe(0);
    expect(find("campaign", "2").state).toMatchObject({ group: "active", label: "Ativo", configured: { code: "ACTIVE" } });
    expect(find("campaign", "3").state).toMatchObject({ group: "paused", label: "Pausado" });
    expect(find("campaign", "1").values.spend).toBeCloseTo(100);
  });
  it("grupo e anúncio ativos sob campanha pausada aparecem como pausados pelo pai, nunca como ativos", () => {
    expect(find("adset", "30").state).toMatchObject({ group: "paused", label: "Campanha pausada" });
    expect(find("ad", "300").state).toMatchObject({ group: "paused", label: "Campanha pausada" });
    expect(find("ad", "101").state).toMatchObject({ group: "paused" });
    expect(find("ad", "100").state).toMatchObject({ group: "active" });
  });
  it("anúncio sem nome usa o primeiro título; sem título, o identificador; o pai e a campanha ficam ligados", () => {
    expect(find("ad", "100").name).toBe("Primeiro título");
    expect(find("ad", "101").name).toBe("Anúncio com nome");
    expect(find("ad", "300").name).toBe("Anúncio 300");
    expect(find("ad", "100")).toMatchObject({ parentId: "10", campaignId: "1" });
    expect(find("adset", "10")).toMatchObject({ parentId: "1", campaignId: "1" });
  });
  it("a ordem padrão não depende de data inexistente na API: sem data, a referência fica vazia", () => {
    expect(find("campaign", "2").state.createdAt ?? null).toBeNull();
  });
  it("consultas só leem (GAQL), com datas validadas e sem remover itens", () => {
    for (const query of [campaignQuery("2026-10-01", "2026-10-02"), adGroupQuery("2026-10-01", "2026-10-02"), adRowsQuery("2026-10-01", "2026-10-02"), campaignListQuery(), adListQuery()]) {
      expect(query.startsWith("SELECT")).toBe(true);
      expect(query).toContain("!= 'REMOVED'");
    }
    expect(() => adGroupQuery("2026-10-01; DROP", "2026-10-02")).toThrow();
    // campos só de versões antigas ou novas da API derrubam a consulta inteira (UNRECOGNIZED_FIELD)
    for (const query of [campaignQuery("2026-10-01", "2026-10-02"), campaignListQuery()]) expect(query).not.toMatch(/start_date|end_date/);
  });
});
