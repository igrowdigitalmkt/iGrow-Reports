import { describe, expect, it } from "vitest";
import { aiAvailability, summarizeAiUsage } from "@/modules/ai/usage-summary";

describe("resumo do consumo de IA do mês", () => {
  it("separa liquidado, reservado e desconhecido; reserva nunca vira consumo liquidado", () => {
    const summary = summarizeAiUsage([
      { status: "ok", cost_usd: 0.1 }, { status: "rejected_numbers", cost_usd: "0.05" }, { status: "error", cost_usd: 0 },
      { status: "reserved", cost_usd: 0.07 }, { status: "reserved", cost_usd: 0.07, needs_reconciliation: false },
      { status: "unknown_consumption", cost_usd: 0.06, needs_reconciliation: true }, { status: "blocked_budget", cost_usd: null },
    ]);
    expect(summary).toEqual({ settledUsd: 0.15, reservedUsd: 0.14, unknownUsd: 0.06, reconcileCount: 1 });
  });
  it("sem linhas tudo é zero", () => {
    expect(summarizeAiUsage([])).toEqual({ settledUsd: 0, reservedUsd: 0, unknownUsd: 0, reconcileCount: 0 });
  });
  it("o disponível considera reservas e desconhecido e respeita o menor entre configurado e plano", () => {
    expect(aiAvailability(5, null, 1.25)).toEqual({ effectiveBudgetUsd: 5, availableUsd: 3.75 });
    expect(aiAvailability(5, 2, 1.25)).toEqual({ effectiveBudgetUsd: 2, availableUsd: 0.75 });
    expect(aiAvailability(5, 2, 9)).toEqual({ effectiveBudgetUsd: 2, availableUsd: 0 });
  });
});
