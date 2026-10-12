import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, PROFILE_FIELDS, PROFILE_NUDGE, profileCompleteness, profileForPrompt, profileInputSchema } from "@/modules/clients/profile";
import { formatFactsForPrompt } from "@/modules/ai/prompt-facts";
import { analysisLines } from "@/modules/reports/pdf/summary";
import type { ReportFacts } from "@/modules/reports/report-facts";

describe("perfil opcional do cliente", () => {
  it("nenhum campo é obrigatório e vazio vira nulo", () => {
    const parsed = profileInputSchema.parse({ segment: "  ", offering: "", goal: "Mais visitas" });
    expect(parsed).toMatchObject({ segment: null, offering: null, location: null, goal: "Mais visitas" });
    expect(profileInputSchema.safeParse({}).success).toBe(true);
  });

  it("respeita o tamanho máximo de cada campo", () => {
    for (const item of PROFILE_FIELDS) {
      expect(profileInputSchema.safeParse({ [item.key]: "a".repeat(item.max) }).success).toBe(true);
      expect(profileInputSchema.safeParse({ [item.key]: "a".repeat(item.max + 1) }).success).toBe(false);
    }
  });

  it("mede o preenchimento e só avisa quando está incompleto", () => {
    expect(profileCompleteness(EMPTY_PROFILE)).toEqual({ filled: 0, total: 7, complete: false });
    expect(profileCompleteness({ segment: "Clínica", goal: "  " })).toMatchObject({ filled: 1, complete: false });
    const full = Object.fromEntries(PROFILE_FIELDS.map(item => [item.key, "x"]));
    expect(profileCompleteness(full)).toMatchObject({ filled: 7, complete: true });
    expect(PROFILE_NUDGE).toContain("Complete o perfil do cliente");
  });

  it("só os campos preenchidos vão para a IA, com chaves próprias do prompt", () => {
    expect(profileForPrompt(EMPTY_PROFILE)).toBeNull();
    expect(profileForPrompt({ segment: "Imobiliária", location: "Teresina", goal: "" })).toEqual({ segmento: "Imobiliária", onde_atua: "Teresina" });
  });

  it("o perfil entra nos fatos da IA apenas quando existe", () => {
    const facts = { period: { from: "2026-09-30", to: "2026-10-06", previousFrom: "2026-09-23", previousTo: "2026-09-29", comparable: true }, currency: "BRL", spend: { current: 1, previous: 1, changePct: 0 }, results: [],
      delivery: { reach: { current: 1, previous: 1, changePct: 0 }, impressions: { current: 1, previous: 1, changePct: 0 }, cpm: { current: 1, previous: 1, changePct: 0 }, frequency: { current: 1, previous: 1, changePct: 0 }, linkClicks: { current: 1, previous: 1, changePct: 0 }, reachEstimated: false },
      campaigns: [], campaignsWithSpend: 0, ads: [], adsWithSpend: 0, adHighlights: { lowestCost: [], highestCost: [], unconfirmed: [] }, commercial: null, accounts: [], limitations: [] } satisfies ReportFacts;
    expect(formatFactsForPrompt(facts)).not.toHaveProperty("perfil_do_cliente");
    expect(formatFactsForPrompt(facts, null)).not.toHaveProperty("perfil_do_cliente");
    expect(formatFactsForPrompt(facts, { segmento: "Escola" }).perfil_do_cliente).toEqual({ segmento: "Escola" });
  });
});

describe("comentário no PDF", () => {
  it("separa as linhas e deixa o rótulo em negrito sem Markdown", () => {
    const lines = analysisLines("Entre 30/09 e 06/10 foram investidos R$ 896,54.\n\nOportunidade: o post teve o menor custo.\nPróxima ação: acompanhar semana a semana.");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual([{ text: "Entre 30/09 e 06/10 foram investidos R$ 896,54." }]);
    expect(lines[1]).toEqual([{ text: "Oportunidade:", bold: true }, { text: " o post teve o menor custo." }]);
    expect(lines[2]?.[0]).toEqual({ text: "Próxima ação:", bold: true });
  });

  it("uma frase longa antes de dois-pontos não vira rótulo", () => {
    const [line] = analysisLines("Veja o que aconteceu neste período de testes com a campanha: foram 5 contatos.");
    expect(line).toHaveLength(1);
    expect(line?.[0]?.bold).toBeUndefined();
  });
});
