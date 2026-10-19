import { describe, expect, it } from "vitest";
import { addMonths, leftMonthFor, monthGrid, monthTitle, pickDay, rangeDays, rangeLabel } from "@/modules/client-portal/period-calendar";

describe("calendario do seletor de periodo", () => {
  it("monta as semanas de domingo a sabado com celulas vazias fora do mes", () => {
    const grid = monthGrid("2026-10-01"); // 1/out/2026 e quinta-feira
    expect(grid[0]).toEqual([null, null, null, null, "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(grid.every(week => week.length === 7)).toBe(true);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
    expect(grid.at(-1)?.[6] === null || grid.at(-1)?.includes("2026-10-31")).toBe(true);
  });

  it("trata fevereiro bissexto e virada de ano ao navegar", () => {
    expect(monthGrid("2028-02-01").flat().filter(Boolean)).toHaveLength(29);
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("formata titulo e intervalo em portugues", () => {
    expect(monthTitle("2026-10-01")).toBe("Outubro de 2026");
    expect(rangeLabel("2026-10-01", "2026-10-19")).toMatch(/^01 de out\.? de 2026 – 19 de out\.? de 2026$/);
    expect(rangeLabel("2026-10-19", "2026-10-19")).not.toContain("–");
    expect(rangeDays("2026-10-01", "2026-10-19")).toBe(19);
  });

  it("dois cliques fecham o intervalo, em qualquer ordem", () => {
    const first = pickDay({ anchor: null, from: "2026-10-01", to: "2026-10-19" }, "2026-10-10");
    expect(first).toEqual({ anchor: "2026-10-10", from: "2026-10-10", to: "2026-10-10" });
    expect(pickDay(first, "2026-10-15")).toEqual({ anchor: null, from: "2026-10-10", to: "2026-10-15" });
    expect(pickDay(first, "2026-10-03")).toEqual({ anchor: null, from: "2026-10-03", to: "2026-10-10" });
  });

  it("mostra o mes anterior ao lado quando o periodo comeca no mes atual", () => {
    expect(leftMonthFor("2026-10-01", "2026-10-19")).toBe("2026-09-01");
    expect(leftMonthFor("2026-08-12", "2026-10-19")).toBe("2026-08-01");
  });
});
