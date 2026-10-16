import { beforeEach, describe, expect, it, vi } from "vitest";

// Travas no fundo das integrações (valem para ação do usuário, rotas diretas e jobs): organização restrita não chega ao provedor.
// Guard real; só o estado financeiro é simulado. As funções reais de Meta/Google são chamadas: se a trava faltasse, o erro seria outro
// (credenciais/ambiente ausentes), nunca BillingRestrictedError.
const mocks = vi.hoisted(() => ({ access: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/billing/access", () => ({ getAgencyBillingAccess: mocks.access }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));

import { BillingRestrictedError } from "@/modules/billing/guard";
import { collectMetaClientInsights, getClientAccountBilling, getClientAudienceBreakdowns, getMetaEntityStatuses, refreshMetaDashboardScope, syncMetaAccountsForClient } from "@/modules/meta/server";
import { syncGoogleAccounts } from "@/modules/google-ads/server";

const agencyId = "00000000-0000-4000-8000-000000000002";
const clientId = "94e033bc-1fe7-4ddb-868d-e2f07b998dae";
const calls: Array<[string, () => Promise<unknown>]> = [
  ["refreshMetaDashboardScope", () => refreshMetaDashboardScope({ agencyId, clientId, data: { selectedAccountIds: ["a"] } as never })],
  ["collectMetaClientInsights", () => collectMetaClientInsights({ agencyId, clientId, actorId: null, since: "2026-09-01", until: "2026-09-30" })],
  ["syncMetaAccountsForClient", () => syncMetaAccountsForClient({ agencyId, clientId, actorId: "u" })],
  ["getClientAccountBilling", () => getClientAccountBilling({ agencyId, clientId })],
  ["getClientAudienceBreakdowns", () => getClientAudienceBreakdowns({ agencyId, clientId, since: "2026-09-01", until: "2026-09-30" })],
  ["syncGoogleAccounts", () => syncGoogleAccounts({} as never, agencyId)],
];

beforeEach(() => { vi.clearAllMocks(); mocks.service.mockReturnValue({}); });

describe("funções reais de sincronização", () => {
  for (const [name, run] of calls) {
    it(`${name}: restrito e não confirmável param ANTES do provedor; liberado segue (e falha por outro motivo neste ambiente sem credenciais)`, async () => {
      for (const state of ["restricted", "unknown"]) {
        mocks.access.mockResolvedValue(state);
        await expect(run()).rejects.toBeInstanceOf(BillingRestrictedError);
      }
      mocks.access.mockResolvedValue("allowed");
      await run().then(() => undefined, error => { expect(error).not.toBeInstanceOf(BillingRestrictedError); });
    });
  }
  it("getMetaEntityStatuses: restrito devolve vazio (o painel mostra o histórico sem status ao vivo)", async () => {
    mocks.access.mockResolvedValue("restricted");
    expect(await getMetaEntityStatuses({ agencyId, clientId, accountIds: ["a"] })).toEqual({});
  });
});
