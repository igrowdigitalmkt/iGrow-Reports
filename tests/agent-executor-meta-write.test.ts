import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { executeMetaWrite } from "@/modules/agent-executor/meta-write";

const now = new Date("2026-10-18T18:00:00Z");
const id = "30000000-0000-4000-8000-000000000003";
const agencyId = "10000000-0000-4000-8000-000000000001";
const clientId = "20000000-0000-4000-8000-000000000002";
function input(action = "pause_campaign") {
  return {
    token: "test-token-not-real", targetId: "111", apiVersion: "v26.0",
    proposal: {
      actionId: id, action, targetId: "111", adAccountId: "act_123",
      factsCollectedAt: "2026-10-18T17:40:00Z",
      rationale: "Agir sobre campanha após um resultado confirmado.",
      ...(action.startsWith("set_") ? { dailyBudgetMinor: 5500 } : {}),
    },
    delegation: {
      agencyId, clientId, adAccountId: "act_123", enabled: true, revokedAt: null,
      expiresAt: "2026-10-19T00:00:00Z",
      allowedActions: ["pause_campaign", "resume_campaign", "set_campaign_daily_budget"],
      maxAccountDailyBudgetMinor: 20_000, maxEntityDailyBudgetMinor: 10_000,
      maxIncreaseMinorPerAction: 6000, maxIncreasePercentPerAction: 20,
    },
    context: {
      agencyId, clientId, adAccountId: "act_123", currency: "BRL",
      hasWritePermission: true, userMayDelegate: true,
      commercialAccessActive: true, metaConnectionActive: true,
      confirmedActiveDailyBudgetMinor: 12_000, budgetCoverageComplete: true,
    },
  };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
const active = { id: "111", account_id: "123", status: "ACTIVE", daily_budget: "5000", objective: "OUTCOME_LEADS" };
const paused = { ...active, status: "PAUSED" };

describe("Meta write — mock HTTP, NUNCA produção", () => {
  it("GET → política → POST restrito → GET confirma pausa", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(active))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response(paused));
    const result = await executeMetaWrite(input(), { fetchImpl, now: () => now });
    expect(result).toEqual({ status: "verified", actionId: id, metaEntityId: "111" });
    expect(fetchImpl.mock.calls.map(c => c[1].method)).toEqual(["GET", "POST", "GET"]);
    const [url, options] = fetchImpl.mock.calls[1];
    expect(String(url)).toBe("https://graph.facebook.com/v26.0/111");
    expect(String(url)).not.toContain("test-token-not-real");
    expect(options.headers.Authorization).toBe("Bearer test-token-not-real");
    expect(options.body.toString()).toBe("status=PAUSED");
  });
  it("rejeita tipo de entidade divergente sem POST", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ id: "111", account_id: "123", status: "ACTIVE", campaign_id: "666" }));
    expect((await executeMetaWrite(input(), { fetchImpl, now: () => now })).status).toBe("blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("bloqueia conta divergente sem POST", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ ...active, account_id: "999" }));
    expect((await executeMetaWrite(input(), { fetchImpl, now: () => now })).status).toBe("blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("não envia POST se faltar autorização", async () => {
    const data = input();
    data.context.hasWritePermission = false;
    const fetchImpl = vi.fn().mockResolvedValue(response(active));
    expect((await executeMetaWrite(data, { fetchImpl, now: () => now })).status).toBe("blocked");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("orçamento é enviado em unidades menores após validação", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(active))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response({ ...active, daily_budget: "5500" }));
    const result = await executeMetaWrite(input("set_campaign_daily_budget"), { fetchImpl, now: () => now });
    expect(result.status).toBe("verified");
    expect(fetchImpl.mock.calls[1][1].body.toString()).toBe("daily_budget=5500");
  });
  it("rede incerta após POST: uma tentativa só, não repete mutação", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(active))
      .mockRejectedValueOnce(new Error("connection reset"));
    const result = await executeMetaWrite(input(), { fetchImpl, now: () => now });
    expect(result.status).toBe("needs_verification");
    expect(fetchImpl.mock.calls.filter(c => c[1].method === "POST")).toHaveLength(1);
  });
  it("POST responde sucesso mas GET não confirma: aguarda reconciliação", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(active))
      .mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response(active));
    const result = await executeMetaWrite(input(), { fetchImpl, now: () => now });
    expect(result.status).toBe("needs_verification");
    expect(fetchImpl.mock.calls.filter(c => c[1].method === "POST")).toHaveLength(1);
  });
  it("não repassa mensagem da Graph API nem token em erros", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: { message: "test-token-not-real" } }, 403));
    const result = await executeMetaWrite(input(), { fetchImpl, now: () => now });
    expect(result.status).toBe("blocked");
    expect(JSON.stringify(result)).not.toContain("test-token-not-real");
  });
  it("não permite versão/ID arbitrários", async () => {
    const data = input();
    data.apiVersion = "v26.0/../accounts";
    const fetchImpl = vi.fn();
    const result = await executeMetaWrite(data, { fetchImpl, now: () => now });
    expect(result.status).toBe("blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
