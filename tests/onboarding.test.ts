import { describe, expect, it } from "vitest";
import { onboardingSteps } from "@/modules/operations/onboarding";
import type { MetaAdminSnapshot } from "@/modules/meta/types";

const client = { id: "client", name: "Cliente", notes: null, archived_at: null, updated_at: "2026-10-02" };
const meta = { accounts: [{ id: "account", archivedAt: null, lastSyncedAt: "2026-10-02" }], links: [{ adAccountId: "account", clientId: "client", active: true }] } as MetaAdminSnapshot;

describe("primeiros passos com dados reais", () => {
  it("não confunde sincronizar contas com atualizar a análise", () => {
    expect(onboardingSteps(client, meta, undefined).map(step => step.complete)).toEqual([true, true, true, false, false]);
  });
  it("não usa contas arquivadas ou de outro cliente como conexão concluída", () => {
    expect(onboardingSteps({ ...client, id: "other" }, meta, undefined)[2].complete).toBe(false);
    expect(onboardingSteps(client, { ...meta, accounts: [] }, undefined)[2].complete).toBe(false);
  });
  it("não conclui um relatório a partir de versões de outro cliente", () => {
    const steps = onboardingSteps(client, meta, { ready: true, versions: [] }, ["client"]);
    expect(steps[3].complete).toBe(true);
    expect(steps[4].complete).toBe(false);
    expect(steps[4].href).toContain(`/dashboard/clientes/${client.id}`);
  });
});
