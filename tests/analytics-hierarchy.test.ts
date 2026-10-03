import { describe, expect, it } from "vitest";
import { normalizeHierarchy } from "@/modules/client-portal/analytics-hierarchy";

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
});
