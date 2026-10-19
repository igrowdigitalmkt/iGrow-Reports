import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { computeBudgetInventory, readBudgetInventory } from "@/modules/agent-executor/financial-inventory";

const NOW = new Date("2026-10-19T12:00:00Z");
const inv = (campaigns: object[], adsets: object[] = []) => computeBudgetInventory({ campaigns, adsets } as never, NOW);

describe("inventario financeiro", () => {
  it("soma orcamento de campanha (CBO) sem duplicar seus conjuntos", () => {
    const r = inv([{ id: "1", status: "ACTIVE", daily_budget: "10000" }],
      [{ id: "11", campaign_id: "1", status: "ACTIVE", daily_budget: "4000" }]);
    expect(r).toEqual({ confirmedActiveDailyBudgetMinor: 10_000, coverageComplete: true, gaps: [] });
  });
  it("soma conjuntos ativos quando a campanha nao tem orcamento e ignora pausados/encerrados", () => {
    const r = inv([{ id: "1", status: "ACTIVE" }, { id: "2", status: "PAUSED", daily_budget: "99999" }], [
      { id: "11", campaign_id: "1", status: "ACTIVE", daily_budget: "3000" },
      { id: "12", campaign_id: "1", status: "ACTIVE", daily_budget: "2000" },
      { id: "13", campaign_id: "1", status: "PAUSED", daily_budget: "7000" },
      { id: "14", campaign_id: "1", status: "ACTIVE", daily_budget: "8000", end_time: "2026-10-01T00:00:00Z" },
      { id: "21", campaign_id: "2", status: "ACTIVE", daily_budget: "5000" },
    ]);
    expect(r).toMatchObject({ confirmedActiveDailyBudgetMinor: 5_000, coverageComplete: true });
  });
  it("cobertura incompleta nunca informa total (vitalicio, ausente, invalido, orfao)", () => {
    const cases: [object[], object[], string][] = [
      [[{ id: "1", status: "ACTIVE", lifetime_budget: "50000" }], [], "lifetime_budget"],
      [[{ id: "1", status: "ACTIVE" }], [{ id: "11", campaign_id: "1", status: "ACTIVE" }], "missing_budget"],
      [[{ id: "1", status: "ACTIVE" }], [{ id: "11", campaign_id: "1", status: "ACTIVE", daily_budget: "1e3" }], "invalid_budget"],
      [[{ id: "1", status: "ACTIVE" }], [{ id: "11", campaign_id: "1", status: "ACTIVE", daily_budget: "100", lifetime_budget: "5" }], "lifetime_budget"],
      [[], [{ id: "11", campaign_id: "9", status: "ACTIVE", daily_budget: "100" }], "orphan_adset"],
    ];
    for (const [c, a, gap] of cases) {
      const r = inv(c, a);
      expect(r.coverageComplete).toBe(false);
      expect(r.confirmedActiveDailyBudgetMinor).toBeNull();
      expect(r.gaps).toContain(gap);
    }
  });
  it("status desconhecido conta como possivelmente ativo (conservador)", () => {
    expect(inv([{ id: "1", daily_budget: "1000" }]).confirmedActiveDailyBudgetMinor).toBe(1_000);
  });
  it("leitura usa somente GET e qualquer falha => cobertura incompleta", async () => {
    const methods: (string | undefined)[] = [];
    const ok = vi.fn(async (url: URL | string, init?: RequestInit) => {
      methods.push(init?.method);
      return new Response(JSON.stringify({ data: String(url).includes("/campaigns")
        ? [{ id: "1", status: "ACTIVE", daily_budget: "2500" }] : [] }), { status: 200 });
    });
    const good = await readBudgetInventory("tok", "act_5", { apiVersion: "v23.0", fetchImpl: ok as never });
    expect(good).toMatchObject({ confirmedActiveDailyBudgetMinor: 2_500, coverageComplete: true });
    expect(methods).toEqual(["GET", "GET"]);
    const bad = await readBudgetInventory("tok", "act_5", { apiVersion: "v23.0", fetchImpl: (async () => new Response("{}", { status: 400 })) as never });
    expect(bad).toMatchObject({ confirmedActiveDailyBudgetMinor: null, coverageComplete: false, gaps: ["read_failed"] });
  });
});
