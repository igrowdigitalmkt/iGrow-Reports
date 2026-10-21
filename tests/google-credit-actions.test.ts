import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/modules/billing/guard", () => ({ ensurePaidOperation: async () => undefined, paidOperationBlock: async () => null, billingBlockOf: () => null, BillingRestrictedError: class extends Error {} }));

const state = { role: "editor", insert: vi.fn(async () => ({ error: null })), update: vi.fn(), accounts: [{ id: "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d", currency: "brl" }], clientFound: true };
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: async () => ({ role: state.role, agency: { id: "agency-1" }, user: { id: "user-1" },
  supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.clientFound ? { id: "c" } : null }) }) }) }) }) } }) }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ from: () => ({ insert: state.insert }) }) }));
vi.mock("@/modules/google-ads/provider", () => ({ linkedGoogleAccounts: async () => state.accounts }));

import { addGoogleCreditAction } from "@/modules/google-ads/credit-actions";

const good = { clientId: "7f8b5d9e-3b2a-4c1d-9e6f-0a1b2c3d4e5f", accountId: "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d", amount: 40, depositedOn: "2026-10-13" };

describe("registrar crédito informado (somente servidor, sem escrever no Google)", () => {
  beforeEach(() => { state.role = "editor"; state.clientFound = true; state.insert.mockClear(); });
  it("editor, administrador e proprietário gravam; a moeda vem da conta, nunca do formulário", async () => {
    for (const role of ["editor", "admin", "owner"]) {
      state.role = role;
      expect(await addGoogleCreditAction({ ...good, currency: "USD" })).toEqual({ ok: true });
    }
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ agency_id: "agency-1", amount: 40, currency: "BRL", created_by: "user-1" }));
  });
  it("leitor não grava", async () => {
    state.role = "viewer";
    expect(await addGoogleCreditAction(good)).toMatchObject({ ok: false });
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("recusa data futura, valor inválido e conta que não é do cliente", async () => {
    expect(await addGoogleCreditAction({ ...good, depositedOn: "2999-01-01" })).toMatchObject({ ok: false, message: expect.stringMatching(/futura/) });
    expect(await addGoogleCreditAction({ ...good, amount: -1 })).toMatchObject({ ok: false });
    expect(await addGoogleCreditAction({ ...good, accountId: "9a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d" })).toMatchObject({ ok: false, message: expect.stringMatching(/vinculada/) });
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("cliente de outra organização não é encontrado", async () => {
    state.clientFound = false;
    expect(await addGoogleCreditAction(good)).toMatchObject({ ok: false, message: "Cliente não encontrado." });
    expect(state.insert).not.toHaveBeenCalled();
  });
});
