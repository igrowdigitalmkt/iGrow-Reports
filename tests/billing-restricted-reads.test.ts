import { beforeEach, describe, expect, it, vi } from "vitest";

// Leitura do histórico continua com acesso restrito: painel usa os dados guardados e só avisa que a atualização está pausada.
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), analytics: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/meta/server", () => ({ refreshMetaDashboardScope: mocks.refresh }));
vi.mock("@/modules/client-portal/analytics", () => ({ getClientAnalytics: mocks.analytics }));
vi.mock("@/modules/billing/access", () => ({ getAgencyBillingAccess: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: vi.fn() }));
import { BillingRestrictedError } from "@/modules/billing/guard";
import { getFreshClientAnalytics } from "@/modules/client-portal/analytics-live";

beforeEach(() => vi.clearAllMocks());

describe("painel de um cliente com acesso restrito", () => {
  const initial = () => ({ coverage: { status: "complete" }, selectedAccountIds: ["a"], warnings: [] as string[], metaAggregate: { confirmed: true } });
  it("devolve os dados guardados, com aviso de atualização pausada, sem registrar falha do provedor", async () => {
    const data = initial();
    mocks.refresh.mockRejectedValue(new BillingRestrictedError("restricted"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await getFreshClientAnalytics({ supabase: {} as never, agencyId: "a", clientId: "c", dateFrom: "2026-09-01", dateTo: "2026-09-30", initial: data as never });
    expect(result).toBe(data);
    expect(data.warnings.join(" ")).toMatch(/pausadas porque o acesso desta organização está restrito/);
    expect(data.warnings.join(" ")).toMatch(/continuam disponíveis para consulta/);
    expect(log).not.toHaveBeenCalled();
    expect(mocks.analytics).not.toHaveBeenCalled(); // não relê: o que já foi lido é o que vale
    log.mockRestore();
  });
  it("falha comum do provedor continua sendo tratada como antes (aviso de nova tentativa e log)", async () => {
    const data = initial();
    mocks.refresh.mockRejectedValue(new Error("timeout"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await getFreshClientAnalytics({ supabase: {} as never, agencyId: "a", clientId: "c", dateFrom: "2026-09-01", dateTo: "2026-09-30", initial: data as never });
    expect(data.warnings.join(" ")).toMatch(/nova tentativa automática/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
