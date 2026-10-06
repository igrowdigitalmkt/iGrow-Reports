import { describe, expect, it } from "vitest";
import { getDemoClientAnalytics } from "@/modules/client-portal/demo-analytics";
import { renderMessage, unknownVariables, usedVariables } from "@/modules/automations/message";
import { describeSchedule, localDate, nextRunAt, resolvePeriod, upcomingRuns, zonedInstant } from "@/modules/automations/schedule";

const SP = "America/Sao_Paulo";

describe("renderMessage", () => {
  const data = getDemoClientAnalytics();

  it("troca as variáveis pelos números do período, em português", () => {
    const text = renderMessage("Olá, {{nome}}! {{cliente}} investiu {{investimento}} em {{periodo}}.", {
      clientName: "Colégio Exemplo", recipientName: "Maria Souza", data,
    });
    expect(text).toMatch(/^Olá, Maria! Colégio Exemplo investiu R\$\s?[\d.]+,\d{2} em \d{2}\/\d{2}\/\d{4} a \d{2}\/\d{2}\/\d{4}\.$/);
  });

  it("lista cada tipo de resultado em uma linha, do maior para o menor", () => {
    const text = renderMessage("{{resultados}}", { clientName: "C", data });
    const lines = text.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every(line => line.startsWith("• "))).toBe(true);
    const numbers = lines.map(line => Number(line.slice(2).split(" ")[0].replace(/\./g, "")));
    expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);
  });

  it("mantém variável desconhecida visível e usa traço quando não há dados", () => {
    expect(renderMessage("{{investimento}} {{investimeto}}", { clientName: "C", data: null })).toBe("— {{investimeto}}");
    expect(unknownVariables("{{investimeto}} {{ cliente }} {{investimeto}}")).toEqual(["investimeto"]);
    expect(usedVariables("{{ Cliente }} {{alcance}}")).toEqual(["cliente", "alcance"]);
  });
});

describe("resolvePeriod", () => {
  it("nunca inclui o dia do envio", () => {
    expect(resolvePeriod("yesterday", "2026-10-07")).toEqual({ dateFrom: "2026-10-06", dateTo: "2026-10-06" });
    expect(resolvePeriod("last_7d", "2026-10-07")).toEqual({ dateFrom: "2026-09-30", dateTo: "2026-10-06" });
    expect(resolvePeriod("last_month", "2026-03-15")).toEqual({ dateFrom: "2026-02-01", dateTo: "2026-02-28" });
  });

  it("no dia 1, 'este mês' envia o mês anterior inteiro", () => {
    expect(resolvePeriod("this_month", "2026-10-01")).toEqual({ dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    expect(resolvePeriod("this_month", "2026-10-10")).toEqual({ dateFrom: "2026-10-01", dateTo: "2026-10-09" });
  });
});

describe("agenda", () => {
  it("converte o horário local do fuso para o instante certo", () => {
    expect(zonedInstant("2026-10-07", "08:30", SP).toISOString()).toBe("2026-10-07T11:30:00.000Z");
    expect(zonedInstant("2026-07-01", "09:00", "Europe/Lisbon").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(localDate(new Date("2026-10-07T02:00:00Z"), SP)).toBe("2026-10-06");
  });

  it("encontra os próximos dias da semana escolhidos", () => {
    const rule = { frequency: "weekly" as const, weekdays: [1, 4], monthDay: 1, sendTime: "08:30", timezone: SP };
    // 2026-10-06 is a Tuesday; 10:00 in São Paulo.
    const runs = upcomingRuns(rule, new Date("2026-10-06T13:00:00Z"), 3).map(run => run.toISOString());
    expect(runs).toEqual(["2026-10-08T11:30:00.000Z", "2026-10-12T11:30:00.000Z", "2026-10-15T11:30:00.000Z"]);
  });

  it("diário pula para amanhã quando o horário de hoje já passou", () => {
    const rule = { frequency: "daily" as const, weekdays: [], monthDay: 1, sendTime: "08:00", timezone: SP };
    expect(nextRunAt(rule, new Date("2026-10-06T10:59:00Z"))?.toISOString()).toBe("2026-10-06T11:00:00.000Z");
    expect(nextRunAt(rule, new Date("2026-10-06T11:00:00Z"))?.toISOString()).toBe("2026-10-07T11:00:00.000Z");
  });

  it("mensal usa o dia do mês e semanal sem dias não agenda", () => {
    const monthly = { frequency: "monthly" as const, weekdays: [], monthDay: 5, sendTime: "07:00", timezone: SP };
    expect(nextRunAt(monthly, new Date("2026-10-06T00:00:00Z"))?.toISOString()).toBe("2026-11-05T10:00:00.000Z");
    expect(nextRunAt({ ...monthly, frequency: "weekly" }, new Date())).toBeNull();
  });

  it("descreve a agenda em linguagem simples", () => {
    const base = { monthDay: 1, sendTime: "08:30:00", timezone: SP };
    expect(describeSchedule({ ...base, frequency: "weekly", weekdays: [4, 1] })).toBe("Toda semana: segunda e quinta, às 08:30");
    expect(describeSchedule({ ...base, frequency: "weekly", weekdays: [1, 2, 3, 4, 5] })).toBe("De segunda a sexta às 08:30");
    expect(describeSchedule({ ...base, frequency: "monthly", weekdays: [], monthDay: 10 })).toBe("Todo dia 10 às 08:30");
  });
});
