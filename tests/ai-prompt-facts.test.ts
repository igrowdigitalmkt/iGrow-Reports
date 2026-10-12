import { describe, expect, it } from "vitest";
import { formatFactsForPrompt } from "@/modules/ai/prompt-facts";
import { COMMENT_SYSTEM_PROMPT } from "@/modules/ai/comment-prompt";
import { verifyNumbers } from "@/modules/ai/number-guard";
import type { ReportFacts } from "@/modules/reports/report-facts";

const facts: ReportFacts = {
  period: { from: "2026-09-30", to: "2026-10-06", previousFrom: "2026-09-23", previousTo: "2026-09-29", comparable: true },
  currency: "BRL",
  spend: { current: 896.54, previous: 785.75, changePct: 14.099904549793187 },
  results: [{ key: "messages", label: "Conversas por mensagem iniciadas", quantity: 66, previousQuantity: 46, changePct: 43.47826086956522, spend: 717.9, costPerResult: 10.877272727272727, previousCostPerResult: null, costChangePct: null }],
  delivery: {
    reach: { current: 53095, previous: 28157, changePct: 88.5676741130092 },
    impressions: { current: 76201, previous: 47409, changePct: 60.7 },
    cpm: { current: 11.765462395506619, previous: 16.57385728448185, changePct: -29.011924058724368 },
    frequency: { current: 1.4351822205480742, previous: 1.6837376140924105, changePct: -14.762121571912246 },
    linkClicks: { current: 1384, previous: 389, changePct: 255.7840616966581 }, reachEstimated: true,
  },
  campaigns: [{ id: "1", name: "SETEMBRO 001 [INSTAGRAM] [MSGM]", accountName: "Ronaldo Moreira", spend: 717.9, shareOfSpend: 80.0745086666518, result: { key: "messages", label: "Conversas por mensagem iniciadas", quantity: 66 }, mixedResults: false, resultConfirmed: true, costPerResult: 10.877272727272727 }],
  campaignsWithSpend: 1, ads: [], adsWithSpend: 0, adHighlights: { lowestCost: [], highestCost: [], unconfirmed: [] },
  accounts: [{ name: "RM Imobiliária", spend: 0, shareOfSpend: 0 }, { name: "Ronaldo Moreira", spend: 896.54, shareOfSpend: 100 }],
  limitations: ["O custo por resultado do período anterior não está disponível; só as quantidades são comparadas."],
};

describe("fatos para a IA", () => {
  it("entrega números prontos em pt-BR, sem a IA calcular nada", () => {
    const text = formatFactsForPrompt(facts);
    expect(text.investimento).toEqual({ atual: "R$ 896,54", anterior: "R$ 785,75", variacao: "+14,1%" });
    expect(text.resultados_por_tipo[0]).toMatchObject({ quantidade: "66", variacao_quantidade: "+43,5%", custo_por_resultado: "R$ 10,88", investimento_nas_campanhas_deste_tipo: "R$ 717,90" });
    expect(text.entrega.cliques_no_link.atual).toBe("1.384");
    expect(text.entrega.frequencia_impressoes_por_pessoa.atual).toBe("1,44");
    expect(text.entrega.cpm.variacao).toBe("-29%");
    expect(text.campanhas_com_maior_investimento[0]?.participacao_no_investimento).toBe("80,1%");
  });
  it("não entrega comparação quando o período anterior não é comparável", () => {
    const text = formatFactsForPrompt({ ...facts, period: { ...facts.period, comparable: false }, spend: { current: 896.54, previous: null, changePct: null } });
    expect(text.periodo_anterior).toBeNull();
    expect(text.investimento.anterior).toBeNull();
    expect(text.investimento.variacao).toBeNull();
  });
  it("o verificador aceita um texto fiel aos fatos formatados e recusa um número inventado", () => {
    const allowed = [JSON.stringify(formatFactsForPrompt(facts))];
    expect(verifyNumbers("66 conversas (+43,5%), a R$ 10,88 cada, com 80,1% do investimento.", allowed).ok).toBe(true);
    expect(verifyNumbers("67 conversas a R$ 10,88 cada.", allowed).unverified).toEqual(["67"]);
  });
  it("o prompt proíbe resultado principal e exige os cinco destaques", () => {
    expect(COMMENT_SYSTEM_PROMPT).toContain("nunca escolha um \"resultado principal\"");
    expect(COMMENT_SYSTEM_PROMPT).not.toContain("Principal resultado");
    expect(COMMENT_SYSTEM_PROMPT).not.toContain("**");
    for (const label of ["Destaque do período", "Ponto de atenção", "Campanha em destaque", "Oportunidade", "Próxima ação"]) expect(COMMENT_SYSTEM_PROMPT).toContain(`${label}:`);
  });
});
