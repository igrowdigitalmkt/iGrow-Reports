import { describe, expect, it } from "vitest";
import { resultCardLayout } from "@/modules/client-portal/result-card-layout";

describe("layout adaptativo dos cards de resultados", () => {
  it("mantém largura e tipografia padrão até três tipos", () => {
    expect(resultCardLayout(3)).toMatchObject({
      wide: false,
      columns: 1,
      rows: 3,
      valueSize: 23,
      labelSize: 11,
      rowGap: 7,
    });
  });

  it("alarga os dois cards e distribui quatro a seis tipos em até três linhas", () => {
    expect(resultCardLayout(4)).toMatchObject({ wide: true, columns: 2, rows: 2, valueSize: 23 });
    expect(resultCardLayout(6)).toMatchObject({ wide: true, columns: 2, rows: 3, valueSize: 23 });
  });

  it("reduz a tipografia quando sete ou oito tipos exigem quatro linhas", () => {
    const seven = resultCardLayout(7);
    const eight = resultCardLayout(8);
    expect(seven).toMatchObject({ wide: true, columns: 2, rows: 4 });
    expect(eight).toMatchObject({ wide: true, columns: 2, rows: 4 });
    expect(seven.valueSize).toBeLessThan(23);
    expect(eight.valueSize).toBe(seven.valueSize);
  });

  it("continua reduzindo progressivamente para novas linhas", () => {
    expect(resultCardLayout(10).rows).toBe(5);
    expect(resultCardLayout(10).valueSize).toBeLessThan(resultCardLayout(8).valueSize);
  });
});
