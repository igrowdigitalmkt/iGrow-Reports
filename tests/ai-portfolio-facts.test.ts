import { describe, expect, it } from "vitest";
import type { PortfolioRow } from "@/modules/operations/portfolio-view";
import { buildPortfolioFacts, PORTFOLIO_SYSTEM_PROMPT } from "@/modules/ai/portfolio-facts";
import { verifyNumbers } from "@/modules/ai/number-guard";

const row = (overrides: Partial<PortfolioRow>): PortfolioRow => ({
  id: "1", name: "Cliente A", linkedAccounts: 1, status: "ok", currency: "BRL", spend: 1000, previousSpend: 1000, reach: 10000, impressions: 20000,
  results: [], trend: [], previousTrend: [], days: [], ...overrides,
});

describe("fatos da carteira para a IA", () => {
  it("transforma status e variações em alertas prontos, sem a IA julgar", () => {
    const facts = buildPortfolioFacts([
      row({ id: "1", name: "Clínica Sorriso", status: "cost-up", spend: 2000, previousSpend: 1500, results: [{ key: "messages", label: "conversas por mensagem iniciadas", value: 80, cost: 25, previousCost: 18 }] }),
      row({ id: "2", name: "Loja Centro", status: "no-delivery", spend: 300, previousSpend: 900 }),
      row({ id: "3", name: "Escola Norte", status: "ok" }),
      row({ id: "4", name: "Imóveis Sul", status: "no-accounts", spend: null, previousSpend: null, currency: null }),
    ], "Últimos 30 dias");
    expect(facts.clientes_ativos).toBe("4");
    expect(facts.clientes_com_alertas).toBe("3");
    expect(facts.clientes_sem_alertas).toBe("1");
    const [clinica, loja, escola, imoveis] = facts.clientes;
    expect(clinica?.alertas).toEqual(["Custo por resultado subiu mais de 20% contra o período anterior.", "Investimento variou +33,3% contra o período anterior."]);
    expect(clinica?.resultados_por_tipo[0]).toMatchObject({ quantidade: "80", custo_por_resultado: "R$ 25,00", custo_por_resultado_periodo_anterior: "R$ 18,00", variacao_do_custo: "+38,9%" });
    expect(loja?.alertas).toContain("Sem veiculação na última semana do período.");
    expect(loja?.alertas).toContain("Investimento variou -66,7% contra o período anterior.");
    expect(escola?.alertas).toEqual([]);
    expect(imoveis).toMatchObject({ alertas: ["Sem conta de anúncios ligada."], investimento: null });
  });

  it("variação pequena de investimento não vira alerta e custo ausente não vira zero", () => {
    const [client] = buildPortfolioFacts([row({ spend: 1100, previousSpend: 1000, results: [{ key: "a", label: "visitas ao perfil", value: 10, cost: null, previousCost: null }, { key: "b", label: "leads", value: 5, cost: null, previousCost: null }] })], "Últimos 7 dias").clientes;
    expect(client?.alertas).toEqual([]);
    expect(client?.resultados_por_tipo.map(item => item.custo_por_resultado)).toEqual([null, null]);
  });

  it("o verificador aceita um texto fiel aos fatos e recusa número inventado", () => {
    const facts = JSON.stringify(buildPortfolioFacts([row({ name: "Loja Centro", status: "no-delivery", spend: 300, previousSpend: 900 })], "Últimos 30 dias"));
    expect(verifyNumbers("Loja Centro: sem veiculação; investimento de R$ 300,00 (-66,7%).", [facts]).ok).toBe(true);
    expect(verifyNumbers("Loja Centro investiu R$ 350,00.", [facts]).unverified).toEqual(["350"]);
  });

  it("o prompt respeita as regras do produto", () => {
    expect(PORTFOLIO_SYSTEM_PROMPT).toContain("nunca escolha um \"resultado principal\"");
    expect(PORTFOLIO_SYSTEM_PROMPT).toContain("sem Markdown");
    expect(PORTFOLIO_SYSTEM_PROMPT).toContain("Nunca use a palavra \"agência\"");
  });
});
