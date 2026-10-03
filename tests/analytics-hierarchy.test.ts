import { describe, expect, it } from "vitest";
import { entityDeliveryActive, entityDeliveryLabel, normalizeHierarchy, relevantCampaignHierarchy, type AnalyticsEntity } from "@/modules/client-portal/analytics-hierarchy";

function campaign(id: string, effectiveStatus: string | null, spend?: number | null, accountId = "account-1"): AnalyticsEntity {
  return { key: `campaign:${id}`, id, level: "campaign", name: `Campaign ${id}`, parentId: null,
    campaignId: id, accountId, accountName: accountId, currency: "BRL", effectiveStatus,
    values: { ...(spend === undefined ? {} : { spend }), impressions: 100, primary_results: 10 } };
}

describe("analytics hierarchy", () => {
  it("preserva status efetivo e thumbnail ao normalizar hierarquia", () => {
    expect(normalizeHierarchy([{
      key: "campaign:1", id: "1", level: "campaign", name: "Campanha ativa",
      parentId: null, campaignId: "1", accountId: "act_1", accountName: "Conta",
      currency: "BRL", values: { spend: 10 }, effectiveStatus: "DELIVERING",
      thumbnailUrl: "https://example.com/thumb.jpg",
    }])).toEqual([expect.objectContaining({
      effectiveStatus: "DELIVERING",
      thumbnailUrl: "https://example.com/thumb.jpg",
    })]);
  });
  it("considera Ativo somente quando a veiculação efetiva atual é ACTIVE", () => {
    expect(entityDeliveryActive({ effectiveStatus: "ACTIVE" })).toBe(true);
    expect(entityDeliveryLabel({ effectiveStatus: "ACTIVE" })).toBe("Ativo");
    for (const effectiveStatus of ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED", "DELIVERING", null]) {
      expect(entityDeliveryActive({ effectiveStatus })).toBe(false);
      expect(entityDeliveryLabel({ effectiveStatus })).toBe("Desativado");
    }
  });

  it.each([0, null, undefined])("inclui campanhas em veiculação com gasto %s", (spend) => {
    const entity = campaign("1", "ACTIVE", spend);
    expect(relevantCampaignHierarchy([entity])).toEqual([entity]);
  });

  it.each(["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED", "UNKNOWN", null])(
    "inclui campanha %s que gastou um centavo no período", (status) => {
      const entity = campaign("1", status, 0.01);
      expect(relevantCampaignHierarchy([entity])).toEqual([entity]);
    },
  );

  it.each([0, null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "exclui campanha inativa com gasto %s mesmo com impressões e resultados", (spend) => {
      expect(relevantCampaignHierarchy([campaign("1", "PAUSED", spend)])).toEqual([]);
    },
  );

  it("reavalia o gasto do período sem ocultar campanhas atualmente em veiculação", () => {
    const current = [campaign("1", "ACTIVE", 0), campaign("2", "PAUSED", 0), campaign("3", "PAUSED", 50)];
    const older = [campaign("1", "ACTIVE", 0), campaign("2", "PAUSED", 25), campaign("3", "PAUSED", 0)];
    expect(relevantCampaignHierarchy(current).map(entity => entity.id)).toEqual(["1", "3"]);
    expect(relevantCampaignHierarchy(older).map(entity => entity.id)).toEqual(["1", "2"]);
  });

  it("mantém descendentes somente da campanha elegível na mesma conta", () => {
    const active = campaign("1", "ACTIVE", 0);
    const inactive = campaign("1", "PAUSED", 0, "account-2");
    const hidden = campaign("2", "PAUSED", 0);
    const children: AnalyticsEntity[] = [
      { ...active, key: "adset:11", id: "11", level: "adset", parentId: "1" },
      { ...active, key: "ad:111", id: "111", level: "ad", parentId: "11" },
      { ...inactive, key: "adset:12", id: "12", level: "adset", parentId: "1", effectiveStatus: "ACTIVE", values: { spend: 5 } },
      { ...hidden, key: "ad:21", id: "21", level: "ad", parentId: "22", effectiveStatus: "ACTIVE", values: { spend: 5 } },
      { ...active, key: "ad:999", id: "999", level: "ad", parentId: "99", campaignId: null },
    ];
    expect(relevantCampaignHierarchy([active, inactive, hidden, ...children])).toEqual([active, children[0], children[1]]);
  });
});
