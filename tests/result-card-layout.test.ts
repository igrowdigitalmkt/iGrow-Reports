import { describe, expect, it } from "vitest";
import { resultCardLayout } from "@/modules/client-portal/result-card-layout";

describe("layout adaptativo dos cards de resultados", () => {
  it("usa um card para cada resultado/custo quando há até três tipos", () => {
    const layout = resultCardLayout(3);
    expect(layout).toMatchObject({ cardSpan: 2, columns: 1, rows: 3, valueSize: 23, labelSize: 9 });
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
