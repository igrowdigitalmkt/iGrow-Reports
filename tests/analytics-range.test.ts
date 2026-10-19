import { describe, expect, it } from "vitest";
import { PERIOD_SHORTCUTS, presetRange, resolveAnalyticsRange } from "../src/modules/client-portal/range";

describe("dashboard date ranges", () => {
  it("uses complete days in the account timezone", () => {
    const now = new Date("2026-10-01T03:30:00Z");
    expect(resolveAnalyticsRange({ periodo: "7d" }, "America/Sao_Paulo", now)).toMatchObject({ dateFrom: "2026-09-24", dateTo: "2026-09-30", previousDateFrom: "2026-09-17", previousDateTo: "2026-09-23" });
    expect(resolveAnalyticsRange({ periodo: "7d" }, "America/Los_Angeles", now).dateTo).toBe("2026-09-29");
  });
  it("supports one year across a leap day", () => {
    expect(resolveAnalyticsRange({ periodo: "365d" }, "UTC", new Date("2024-03-01T12:00:00Z"))).toMatchObject({ dateFrom: "2023-03-02", dateTo: "2024-02-29" });
  });
  it("waits for the day to finish in every selected account timezone", () => {
    expect(resolveAnalyticsRange({ periodo: "7d" }, ["America/Sao_Paulo", "America/Los_Angeles"], new Date("2026-10-01T03:30:00Z"))).toMatchObject({ dateFrom: "2026-09-23", dateTo: "2026-09-29" });
  });
  it("compares a custom inclusive interval with equal previous days", () => {
    expect(resolveAnalyticsRange({ periodo: "custom", from: "2026-09-01", to: "2026-09-30" }, "UTC", new Date("2026-10-01"))).toMatchObject({ previousDateFrom: "2026-08-02", previousDateTo: "2026-08-31" });
  });
  it.each([["2026-02-30", "2026-03-01"], ["2026-09-30", "2026-09-01"], ["2025-01-01", "2026-09-30"], ["2026-09-01", "2027-01-01"]])("rejects invalid ranges %s — %s", (from, to) => {
    expect(() => resolveAnalyticsRange({ periodo: "custom", from, to }, "UTC", new Date("2026-10-01"))).toThrow();
  });

  describe("atalhos do seletor de periodo", () => {
    const now = new Date("2026-10-19T15:00:00Z"); // 19/10/2026 no fuso de Sao Paulo
    const range = (periodo: string) => resolveAnalyticsRange({ periodo }, "America/Sao_Paulo", now);

    it("Hoje, Ontem e Esse mes incluem o dia certo", () => {
      expect(range("today")).toMatchObject({ period: "today", dateFrom: "2026-10-19", dateTo: "2026-10-19", previousDateFrom: "2026-10-18", previousDateTo: "2026-10-18" });
      expect(range("yesterday")).toMatchObject({ period: "yesterday", dateFrom: "2026-10-18", dateTo: "2026-10-18" });
      expect(range("month")).toMatchObject({ period: "month", dateFrom: "2026-10-01", dateTo: "2026-10-19" });
    });

    it("Ultimo mes cobre o mes anterior inteiro, inclusive na virada de ano e em fevereiro bissexto", () => {
      expect(range("last-month")).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-30" });
      expect(resolveAnalyticsRange({ periodo: "last-month" }, "UTC", new Date("2026-01-10T12:00:00Z"))).toMatchObject({ dateFrom: "2025-12-01", dateTo: "2025-12-31" });
      expect(resolveAnalyticsRange({ periodo: "last-month" }, "UTC", new Date("2024-03-05T12:00:00Z"))).toMatchObject({ dateFrom: "2024-02-01", dateTo: "2024-02-29" });
    });

    it("Esse mes no dia 1 tem um unico dia", () => {
      expect(resolveAnalyticsRange({ periodo: "month" }, "UTC", new Date("2026-11-01T08:00:00Z"))).toMatchObject({ dateFrom: "2026-11-01", dateTo: "2026-11-01" });
    });

    it.each([["3d", "2026-10-16"], ["7d", "2026-10-12"], ["14d", "2026-10-05"], ["30d", "2026-09-19"], ["60d", "2026-08-20"], ["90d", "2026-07-21"]])(
      "Ultimos %s terminam ontem (dia completo) e comecam em %s", (periodo, dateFrom) => {
        expect(range(periodo)).toMatchObject({ period: periodo, dateFrom, dateTo: "2026-10-18" });
      });

    it("usa o dia mais atrasado entre as contas selecionadas", () => {
      expect(resolveAnalyticsRange({ periodo: "today" }, ["America/Sao_Paulo", "America/Los_Angeles"], new Date("2026-10-01T03:30:00Z")))
        .toMatchObject({ dateFrom: "2026-09-30", dateTo: "2026-09-30" });
    });

    it("mantem links antigos (180d, 365d) e cai em 30 dias para valores desconhecidos", () => {
      expect(range("180d").period).toBe("180d");
      expect(range("365d").period).toBe("365d");
      expect(range("semana").period).toBe("30d");
    });

    it("a lista do seletor nao tem atalhos de semana e traz Ontem no lugar de Dia anterior", () => {
      const labels = PERIOD_SHORTCUTS.map(item => item.label);
      expect(labels).toEqual(["Hoje", "Ontem", "Esse mês", "Último mês", "Últimos 3 dias", "Últimos 7 dias", "Últimos 14 dias", "Últimos 30 dias", "Últimos 60 dias", "Últimos 90 dias"]);
      expect(labels.some(label => /semana|dia anterior/i.test(label))).toBe(false);
    });

    it("presetRange devolve null para personalizado e desconhecido", () => {
      expect(presetRange("custom", "2026-10-19")).toBeNull();
      expect(presetRange("xyz", "2026-10-19")).toBeNull();
    });
  });
});
