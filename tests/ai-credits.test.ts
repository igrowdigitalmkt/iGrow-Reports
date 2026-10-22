import { describe, expect, it } from "vitest";
import { AI_CREDITS_PER_USD, aiCreditsView, creditsToUsd, formatCredits, usdToCredits } from "@/modules/ai/credits";

describe("créditos de IA", () => {
  it("converte dólar em créditos em escala alta e de volta", () => {
    expect(AI_CREDITS_PER_USD).toBe(2000);
    expect(usdToCredits(5)).toBe(10000);
    expect(usdToCredits(0.0125)).toBe(25);
    expect(creditsToUsd(10000)).toBe(5);
    expect(usdToCredits(-1)).toBe(0);
  });

  it("formata em pt-BR", () => {
    expect(formatCredits(8452)).toMatch(/^8\.452$/);
  });

  it("calcula uso, restante e nível", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const ok = aiCreditsView({ budgetUsd: 5, costUsd: 1, now });
    expect(ok).toMatchObject({ limit: 10000, used: 2000, remaining: 8000, percent: 20, level: "ok", resetsOn: "2026-11-01" });
    expect(aiCreditsView({ budgetUsd: 5, costUsd: 4.2, now }).level).toBe("warning");
    const done = aiCreditsView({ budgetUsd: 5, costUsd: 6, now });
    expect(done).toMatchObject({ used: 10000, remaining: 0, percent: 100, level: "exhausted" });
  });

  it("sem limite disponível aparece como esgotado e vira o ano na renovação", () => {
    const view = aiCreditsView({ budgetUsd: 0, costUsd: 0, now: new Date("2026-12-15T00:00:00Z") });
    expect(view).toMatchObject({ limit: 0, percent: 100, level: "exhausted", resetsOn: "2027-01-01" });
  });
});
