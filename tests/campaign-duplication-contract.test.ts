import { describe, expect, it } from "vitest";
import { createCampaignSchema, duplicateRequestSchema, planDuplication, DUPLICATE_SYNC_CHILD_LIMIT } from "@/modules/campaigns/manual/duplication-contract";

describe("contratos de duplicação e criação (sem execução)", () => {
  const base = { level: "adset", sourceId: "123", targetParentId: "900", statusOption: "PAUSED" };
  it("a cópia só pode nascer pausada; ativa ou herdada nunca passa", () => {
    expect(duplicateRequestSchema.safeParse(base).success).toBe(true);
    for (const statusOption of ["ACTIVE", "INHERITED_FROM_SOURCE", "paused", undefined]) expect(duplicateRequestSchema.safeParse({ ...base, statusOption }).success).toBe(false);
  });
  it("destino e filhos coerentes com o nível; campos desconhecidos recusados", () => {
    expect(duplicateRequestSchema.safeParse({ level: "campaign", sourceId: "1", statusOption: "PAUSED" }).success).toBe(true);
    expect(duplicateRequestSchema.safeParse({ level: "campaign", sourceId: "1", targetParentId: "2", statusOption: "PAUSED" }).success).toBe(false);
    expect(duplicateRequestSchema.safeParse({ level: "ad", sourceId: "1", targetParentId: "2", statusOption: "PAUSED", deepCopy: true }).success).toBe(false);
    expect(duplicateRequestSchema.safeParse({ ...base, sourceId: "abc" }).success).toBe(false);
    expect(duplicateRequestSchema.safeParse({ ...base, endpoint: "/me" }).success).toBe(false);
    expect(duplicateRequestSchema.safeParse({ ...base, rename: { strategy: "PERIGOSO" } }).success).toBe(false);
  });
  it("planejamento: destino obrigatório e limite da cópia profunda síncrona", () => {
    const request = duplicateRequestSchema.parse({ ...base, deepCopy: true });
    expect(planDuplication(request, { childCount: DUPLICATE_SYNC_CHILD_LIMIT })).toEqual({ ok: true, mode: "sync" });
    expect(planDuplication(request, { childCount: DUPLICATE_SYNC_CHILD_LIMIT + 1 })).toMatchObject({ ok: false, blockers: [expect.stringMatching(/assíncrona/)] });
    const noTarget = { ...duplicateRequestSchema.parse(base), targetParentId: undefined };
    expect(planDuplication(noTarget, { childCount: 0 })).toMatchObject({ ok: false });
  });
  it("criar campanha: sempre pausada, leilão, categorias declaradas, nome válido, sem orçamento implícito", () => {
    const ok = { name: "Campanha nova", objective: "OUTCOME_LEADS", specialAdCategories: ["NONE"], buyingType: "AUCTION", status: "PAUSED" };
    expect(createCampaignSchema.safeParse(ok).success).toBe(true);
    expect(createCampaignSchema.safeParse({ ...ok, dailyBudgetMinor: 5000 }).success).toBe(true);
    for (const over of [{ status: "ACTIVE" }, { name: "  " }, { objective: "LEAD_GENERATION" }, { specialAdCategories: [] }, { buyingType: "RESERVED" }, { dailyBudgetMinor: 0 }, { extra: 1 }]) {
      expect(createCampaignSchema.safeParse({ ...ok, ...over }).success).toBe(false);
    }
  });
});
