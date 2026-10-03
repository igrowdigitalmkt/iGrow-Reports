import { describe, expect, it } from "vitest";
import { COLLECTION_SLICE_DAYS, coveringCollectionRun, normalizeInsightSlice, periodInsightMetrics, periodScalarValue, splitCollectionRange, validateCollectionRange } from "@/modules/meta/collection";

const input = {
  agencyId: "agency", accountId: "account", externalAccountId: "act_1",
  since: "2026-09-01", until: "2026-09-30", timezoneName: "America/Sao_Paulo",
  businessId: "123", apiVersion: "v26.0", collectedAt: "2026-10-01T00:00:00Z",
  accountInsights: [{ date_start: "2026-09-10", date_stop: "2026-09-10", account_id: "1", spend: "10.23", impressions: "100", reach: "90" }],
  campaignInsights: [{ date_start: "2026-09-10", date_stop: "2026-09-10", account_id: "1", campaign_id: "22", campaign_name: "Campanha", spend: "10.23", impressions: "100", reach: "90" }],
};

describe("coleta histórica Meta", () => {
  it("keeps omitted exposure unknown unless the provider explicitly proves no delivery", () => {
    expect(periodScalarValue({ actions: [{ action_type: "lead", value: "1" }] }, "reach")).toBeNull();
    expect(periodScalarValue({ impressions: "0", spend: "0" }, "clicks")).toBe(0);
    expect(periodScalarValue({ impressions: "100", spend: "10" }, "reach")).toBeNull();
    expect(periodScalarValue({ reach: "50", impressions: "100" }, "reach")).toBe(50);
  });
  it("divide um ano sem lacunas nem sobreposição em lotes pequenos e recuperáveis", () => {
    const slices = splitCollectionRange("2025-10-01", "2026-09-30");
    expect(COLLECTION_SLICE_DAYS).toBe(7);
    expect(slices).toHaveLength(53);
    expect(slices[0].since).toBe("2025-10-01");
    expect(slices.at(-1)?.until).toBe("2026-09-30");
    let total = 0;
    for (let index = 0; index < slices.length; index += 1) {
      const slice = slices[index];
      const days = validateCollectionRange(slice.since, slice.until).days;
      expect(days).toBeLessThanOrEqual(COLLECTION_SLICE_DAYS);
      total += days;
      if (index > 0) expect(new Date(`${slice.since}T00:00:00Z`).getTime() - new Date(`${slices[index - 1].until}T00:00:00Z`).getTime()).toBe(86_400_000);
    }
    expect(total).toBe(365);
  });

  it("reaproveita um lote completo que cobre integralmente um sublote novo", () => {
    const runs = [{ date_from: "2026-09-01", date_to: "2026-09-30", levels: ["account", "campaign"] }];
    expect(coveringCollectionRun(runs, { since: "2026-09-08", until: "2026-09-14" })).toBe(runs[0]);
    expect(coveringCollectionRun(runs, { since: "2026-09-08", until: "2026-09-14" }, ["account", "campaign", "ad"])).toBeUndefined();
    expect(coveringCollectionRun(runs, { since: "2026-09-29", until: "2026-10-02" })).toBeUndefined();
  });

  it("valida datas reais e limite inclusivo de 370 dias", () => {
    expect(validateCollectionRange("2024-02-29", "2024-02-29").days).toBe(1);
    expect(validateCollectionRange("2025-01-01", "2026-01-05").days).toBe(370);
    expect(() => validateCollectionRange("2025-01-01", "2026-01-06")).toThrow();
    expect(() => validateCollectionRange("2026-02-29", "2026-03-01")).toThrow();
    expect(() => validateCollectionRange("2026-09-30", "2026-09-01")).toThrow();
  });

  it("preserva métricas e ações separadas por nível sem duplicar ações de valor", () => {
    const normalized = normalizeInsightSlice({
      ...input,
      accountInsights: [{ ...input.accountInsights[0], clicks: "15", outbound_clicks: [{ action_type: "outbound_click", value: "8" }], actions: [{ action_type: "lead", value: "2" }, { action_type: "lead", value: "3" }], action_values: [{ action_type: "purchase", value: "200.50" }] }],
    });
    expect(normalized.insights).toHaveLength(2);
    expect(normalized.insights.map((row) => row.level)).toEqual(["account", "campaign"]);
    expect(normalized.insights[1].parent_external_id).toBe("act_1");
    expect(normalized.insights[0].metadata).toMatchObject({ clicks: 15, outbound_clicks: 8, video_play_actions: null });
    expect(normalized.insights[0].metadata).toMatchObject({ analytics_version: 8, actions_confirmed: true,
      action_values_confirmed: true, canonical_values: { "action:lead": 5, primary_results: null } });
    expect(normalized.actions).toHaveLength(2);
    expect(normalized.actions.find((action) => action.action_type === "lead")?.action_value).toBe(5);
    expect(normalized.actions.find((action) => action.action_type === "purchase")).toMatchObject({ action_value: 0, value_amount: 200.5 });
  });

  it("recusa dados de outra conta, datas fora do escopo e valores inválidos", () => {
    expect(() => normalizeInsightSlice({ ...input, accountInsights: [{ ...input.accountInsights[0], account_id: "2" }] })).toThrow("fora da conta");
    expect(() => normalizeInsightSlice({ ...input, accountInsights: [{ ...input.accountInsights[0], date_start: "2026-08-01" }] })).toThrow("fora da conta");
    expect(() => normalizeInsightSlice({ ...input, accountInsights: [{ ...input.accountInsights[0], spend: "NaN" }] })).toThrow();
    expect(() => normalizeInsightSlice({ ...input, accountInsights: [{ ...input.accountInsights[0], spend: "-1" }] })).toThrow();
  });

  it("não transforma alcance ausente em zero nem soma alcances diários", () => {
    expect(periodInsightMetrics(undefined)).toEqual({ reach: null, frequency: null, unique_clicks: null });
    expect(periodInsightMetrics({ date_start: "2026-09-01", date_stop: "2026-09-30", reach: "150", frequency: "1.3333", unique_clicks: "7" })).toEqual({ reach: 150, frequency: 1.3333, unique_clicks: 7 });
  });
});
