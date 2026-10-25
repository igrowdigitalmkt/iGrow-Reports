import { describe, expect, it } from "vitest";
import { classifyDelivery, withConfiguredStatus } from "@/modules/campaigns/delivery-state";

const live = (status: string, configured: string) => ({ status, configured, accountBlocked: false, issues: false, createdAt: null }) as never;

describe("estado otimista de pausa e retomada", () => {
  it("pausar mostra a campanha como pausada na hora, sem apagar o histórico de criação", () => {
    const before = { ...classifyDelivery(live("ACTIVE", "ACTIVE"), false), createdAt: "2026-10-01T00:00:00Z" };
    expect(before.restrictions.map(item => item.key)).toContain("no_delivery");
    const after = withConfiguredStatus(before, "PAUSED");
    expect(after).toMatchObject({ group: "paused", label: "Pausado", configured: { code: "PAUSED" }, effective: { code: "PAUSED" }, createdAt: "2026-10-01T00:00:00Z" });
    expect(after.restrictions).toEqual([]);
  });

  it("retomar muda o estado efetivo só quando ele era Pausado", () => {
    const paused = classifyDelivery(live("PAUSED", "PAUSED"));
    expect(withConfiguredStatus(paused, "ACTIVE")).toMatchObject({ group: "active", label: "Ativo", configured: { code: "ACTIVE" }, effective: { code: "ACTIVE" } });
    const parentPaused = classifyDelivery(live("CAMPAIGN_PAUSED", "PAUSED"));
    const resumed = withConfiguredStatus(parentPaused, "ACTIVE");
    expect(resumed.configured?.code).toBe("ACTIVE");
    expect(resumed.effective?.code).toBe("CAMPAIGN_PAUSED");
    expect(resumed.group).toBe("paused");
  });

  it("sem estado efetivo conhecido, retomar mostra ativo", () => {
    expect(withConfiguredStatus(classifyDelivery(null), "ACTIVE")).toMatchObject({ group: "active", configured: { code: "ACTIVE" } });
  });
});
