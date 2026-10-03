import { describe, expect, it } from "vitest";
import { resultCardLayout, wrapResultLabel } from "@/modules/client-portal/result-card-layout";

describe("layout adaptativo dos cards de resultados", () => {
  it("usa um card para cada resultado/custo quando há até três tipos", () => {
    const layout = resultCardLayout(3);
    expect(layout).toMatchObject({ cardSpan: 2, columns: 1, rows: 3, valueSize: 23, labelSize: 10.5 });
    expect(2 + layout.cardSpan * 2).toBe(6);
  });

  it("usa dois cards para cada resultado/custo entre quatro e seis tipos", () => {
    expect(resultCardLayout(4)).toMatchObject({ cardSpan: 4, columns: 2, rows: 2, valueSize: 23 });
    const layout = resultCardLayout(6);
    expect(layout).toMatchObject({ cardSpan: 4, columns: 2, rows: 3, valueSize: 23 });
    expect(2 + layout.cardSpan * 2).toBe(10);
  });

  it("usa dois cards e meio para cada resultado/custo a partir de sete tipos", () => {
    const seven = resultCardLayout(7);
    const eight = resultCardLayout(8);
    expect(seven).toMatchObject({ cardSpan: 5, columns: 2, rows: 4 });
    expect(eight).toMatchObject({ cardSpan: 5, columns: 2, rows: 4 });
    expect(2 + seven.cardSpan * 2).toBe(12);
    expect(seven.valueSize).toBeLessThan(23);
    expect(eight.valueSize).toBe(seven.valueSize);
  });

  it("reduz apenas a tipografia conforme surgem novas linhas", () => {
    expect(resultCardLayout(10).rows).toBe(5);
    expect(resultCardLayout(10).valueSize).toBeLessThan(resultCardLayout(8).valueSize);
    expect(resultCardLayout(12).valueSize).toBeLessThanOrEqual(resultCardLayout(10).valueSize);
  });
});

describe("descrições legíveis dos resultados", () => {
  it("preserva a fonte da descrição em todas as densidades", () => {
    for (const count of [1, 3, 5, 7, 10, 20]) expect(resultCardLayout(count).labelSize).toBe(10.5);
  });

  it("equilibra os rótulos reais em no máximo duas linhas", () => {
    expect(wrapResultLabel("conversas por mensagem iniciadas")).toEqual(["conversas por", "mensagem iniciadas"]);
    expect(wrapResultLabel("visitas ao perfil do instagram")).toEqual(["visitas ao perfil", "do instagram"]);
    expect(wrapResultLabel("cliques no link")).toEqual(["cliques no link"]);
  });

  it("hifeniza palavras longas sem perder caracteres", () => {
    const word = "a".repeat(52);
    const lines = wrapResultLabel(word);
    expect(lines).toEqual([`${"a".repeat(17)}-`, "a".repeat(35)]);
    expect(lines).toHaveLength(2);
    expect(lines.join("").replaceAll("-", "")).toBe(word);
  });

  it("normaliza espaços e aceita descrições vazias", () => {
    expect(wrapResultLabel("  engajamento   com a publicação  ")).toEqual(["engajamento com", "a publicação"]);
    expect(wrapResultLabel("  ")).toEqual([]);
  });
});
