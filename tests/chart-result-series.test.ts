import { describe, expect, it } from "vitest";
import { resultFamilyValue, withResultSeries } from "@/modules/client-portal/analytics-results";
import { isRateMetric } from "@/modules/client-portal/analytics-charts";

const metric = (key: string, unit: "currency" | "integer" | "percent" | "ratio") => ({ key, label: key, unit, precision: 2, desirable: "neutral" as const });

describe("serie de resultados do grafico", () => {
  it("le o agregado da Meta por tipo de resultado, com zero quando o dia nao teve", () => {
    const day = { "result:provider_known": 1, "result:provider:action:lead": 4, "result:provider:action:onsite_conversion.messaging_conversation_started_7d": 9 };
    expect(resultFamilyValue(day, "leads")).toBe(4);
    expect(resultFamilyValue(day, "messages")).toBe(9);
    expect(resultFamilyValue(day, "purchases")).toBe(0);
  });

  it("sem agregado confirmado usa o grupo conhecido ou deixa o dia em branco", () => {
    expect(resultFamilyValue({ "result:leads": 3 }, "leads")).toBe(3);
    expect(resultFamilyValue({}, "leads")).toBeNull();
  });

  it("acrescenta a serie a cada dia sem alterar os valores originais", () => {
    const days: Array<{ date: string; values: Record<string, number | null> }> = [{ date: "2026-10-01", values: { spend: 10, "result:leads": 2 } }];
    const out = withResultSeries(days, [{ key: "leads" }]);
    expect(out[0].values["chart:result:leads"]).toBe(2);
    expect(out[0].values.spend).toBe(10);
    expect(days[0].values).not.toHaveProperty("chart:result:leads");
  });

  it("taxas e custos usam escala ajustada; volumes e valor usado partem do zero", () => {
    expect(isRateMetric(metric("cpm", "currency"))).toBe(true);
    expect(isRateMetric(metric("ctr_link", "percent"))).toBe(true);
    expect(isRateMetric(metric("frequency", "ratio"))).toBe(true);
    expect(isRateMetric(metric("spend", "currency"))).toBe(false);
    expect(isRateMetric(metric("impressions", "integer"))).toBe(false);
  });
});
