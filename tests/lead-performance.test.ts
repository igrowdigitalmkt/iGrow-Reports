import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/client-portal/analytics", () => ({ getClientAnalytics: vi.fn() }));

import { buildPerformance, windowOf } from "@/modules/lead-pages/hub-performance";
import { platformLabel } from "@/modules/lead-pages/hub-types";

const row = (campaign_id: string | null, status = "new", campaign_name: string | null = null) => ({ campaign_id, campaign_name, status });
const spend = new Map([["5001", { spend: 300, currency: "BRL", name: "Terras Alphaville" }], ["5002", { spend: 150, currency: "BRL", name: "Bate-papo" }]]);

describe("desempenho por campanha", () => {
  it("agrupa os leads, conta o funil e calcula o custo por lead e por fechado", () => {
    const result = buildPerformance({ rows: [row("5001", "new"), row("5001", "contacted"), row("5001", "won"), row("5001", "won"), row("5002", "lost"), row("5002", "visit")], spendByCampaign: spend });
    expect(result.rows[0]).toMatchObject({ campaignId: "5001", name: "Terras Alphaville", leads: 4, inProgress: 1, won: 2, spend: 300, costPerLead: 75, costPerWon: 150 });
    expect(result.rows[1]).toMatchObject({ campaignId: "5002", leads: 2, visits: 1, lost: 1, spend: 150, costPerLead: 75, costPerWon: null });
    expect(result.totals).toMatchObject({ leads: 6, won: 2, spend: 450, currency: "BRL", costPerLead: 75, costPerWon: 225 });
  });
  it("campanha sem investimento confirmado fica sem custo (nunca zero) e derruba o total de custo", () => {
    const result = buildPerformance({ rows: [row("5001"), row("9999", "new", "De outra conta")], spendByCampaign: spend });
    const other = result.rows.find(item => item.campaignId === "9999")!;
    expect(other).toMatchObject({ name: "De outra conta", spend: null, costPerLead: null });
    expect(result.totals).toMatchObject({ leads: 2, spend: null, costPerLead: null });
  });
  it("sem leitura do investimento, mostra os leads e deixa todos os custos indisponíveis", () => {
    const result = buildPerformance({ rows: [row("5001"), row("5001", "won")], spendByCampaign: null });
    expect(result.rows[0]).toMatchObject({ leads: 2, spend: null, costPerLead: null, costPerWon: null });
    expect(result.totals).toMatchObject({ spend: null, costPerLead: null });
  });
  it("leads sem campanha identificada viram uma linha própria e não entram no custo", () => {
    const result = buildPerformance({ rows: [row("5001"), row(null), row(null)], spendByCampaign: spend });
    expect(result.rows.map(item => item.name)).toEqual(["Sem campanha identificada", "Terras Alphaville"]);
    expect(result.totals).toMatchObject({ leads: 3, spend: 300, costPerLead: 300 });
  });
  it("janela do período em horário de Brasília e rótulo da plataforma", () => {
    expect(windowOf("2026-11-01", "2026-11-02")).toEqual({ from: "2026-11-01T00:00:00-03:00", to: "2026-11-02T23:59:59.999-03:00" });
    expect(platformLabel("ig")).toBe("Instagram");
    expect(platformLabel("fb")).toBe("Facebook");
    expect(platformLabel("messenger")).toBe("Messenger");
    expect(platformLabel(null)).toBeNull();
  });
});
