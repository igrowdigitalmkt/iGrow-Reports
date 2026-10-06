import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { planRun } from "@/modules/automations/runner";
import { deliverToDestinations, runStatus, type MessageSender } from "@/modules/automations/sender";

const base = { frequency: "weekly" as const, weekdays: [1, 4], month_day: 1, send_time: "08:30:00", timezone: "America/Sao_Paulo", period_key: "last_7d" as const };

describe("planRun", () => {
  it("usa a data local do horário programado e agenda o próximo dia escolhido", () => {
    const plan = planRun({ ...base, next_run_at: "2026-10-08T11:30:00.000Z" }, new Date("2026-10-08T11:31:00Z"));
    expect(plan.period).toEqual({ dateFrom: "2026-10-01", dateTo: "2026-10-07" });
    expect(plan.next?.toISOString()).toBe("2026-10-12T11:30:00.000Z");
  });

  it("não reenvia horários perdidos: o próximo fica no futuro", () => {
    const plan = planRun({ ...base, next_run_at: "2026-09-03T11:30:00.000Z" }, new Date("2026-10-06T13:00:00Z"));
    expect(plan.scheduledFor.toISOString()).toBe("2026-09-03T11:30:00.000Z");
    expect(plan.next?.toISOString()).toBe("2026-10-08T11:30:00.000Z");
  });
});

describe("deliverToDestinations", () => {
  it("conta envios e falhas e explica cada falha", async () => {
    const sender: MessageSender = { sendText: vi.fn(async destination => destination.kind === "group" ? { ok: false as const, error: "grupo não encontrado" } : { ok: true as const }) };
    const report = await deliverToDestinations(sender, [
      { kind: "phone", phone: "+5511988887777", label: "Maria" },
      { kind: "group", groupId: "1@g.us", label: "Diretoria" },
    ], "Olá", () => 0);
    expect(report).toEqual({ sent: 1, failed: 1, errors: ["Diretoria: grupo não encontrado"] });
    expect(runStatus(report)).toBe("partial");
    expect(runStatus({ sent: 2, failed: 0, errors: [] })).toBe("sent");
    expect(runStatus({ sent: 0, failed: 1, errors: ["x"] })).toBe("failed");
  });

  it("uma exceção do canal vira falha sem interromper os demais", async () => {
    let calls = 0;
    const sender: MessageSender = { sendText: async () => { calls += 1; if (calls === 1) throw new Error("offline"); return { ok: true }; } };
    const report = await deliverToDestinations(sender, [
      { kind: "phone", phone: "+1", label: "A" }, { kind: "phone", phone: "+2", label: "B" },
    ], "Olá", () => 0);
    expect(report.sent).toBe(1);
    expect(report.errors[0]).toMatch(/^A: /);
  });
});
