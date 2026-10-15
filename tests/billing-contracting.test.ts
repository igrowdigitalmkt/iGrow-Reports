import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, type AsaasApi } from "@/modules/billing/asaas-client";
import { cancelSubscriptionRequest, checkoutMessage, startCheckout, type StartCheckoutInput } from "@/modules/billing/contracting";
import type { BillingDb } from "@/modules/billing/db";
import type { BillingDeps } from "@/modules/billing/event-processor";

type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: BillingDb = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      try { return { data: handlers[name]?.(args) ?? null, error: null }; }
      catch (error) { return { data: null, error: { code: (error as { code?: string }).code ?? "XX000", message: (error as Error).message } }; }
    },
  };
  return { db, of: (name: string) => calls.filter((call) => call.name === name) };
}
const dbError = (code: string) => Object.assign(new Error("erro"), { code });
const intent = (patch: Record<string, unknown> = {}) => ({ intent_id: "int-1", status: "creating", reused: false, asaas_checkout_id: null, checkout_url: null, amount_cents: 4990, checkout_minutes: 30, expires_at: "2026-10-15T15:32:00Z", ...patch });

function asaasFake(overrides: Partial<AsaasApi> = {}) {
  return {
    createCustomer: vi.fn(async () => ({ id: "cus_123456" })),
    createCheckout: vi.fn(async () => ({ id: "chk_123456", link: "https://sandbox.example.test/checkout/chk_123456" })),
    cancelSubscription: vi.fn(async () => undefined), getPayment: vi.fn(), getSubscription: vi.fn(), listSubscriptionPayments: vi.fn(), ...overrides,
  } as unknown as AsaasApi & { createCustomer: ReturnType<typeof vi.fn>; createCheckout: ReturnType<typeof vi.fn>; cancelSubscription: ReturnType<typeof vi.fn> };
}
const deps = (db: BillingDb, asaas: AsaasApi): BillingDeps => ({ db, asaas, environment: "sandbox", now: () => new Date("2026-10-15T15:00:00Z") });
const input = (patch: Partial<StartCheckoutInput> = {}): StartCheckoutInput => ({
  agencyId: "agency-1", userId: "user-1", planVersionId: "pv-1", cycle: "monthly", requestKey: "chave-0001-aaaa", planName: "Plano Pro",
  urls: { successUrl: "https://app.test/ok", cancelUrl: "https://app.test/cancelado", expiredUrl: "https://app.test/expirado" },
  loadCustomerData: vi.fn(async () => ({ name: "Org", cpfCnpj: "00000000000", email: "a@b.test", phone: "4738010919", postalCode: "89223005", address: "Rua Teste", addressNumber: "277", province: "Centro" })), ...patch,
});

describe("contratação: no máximo uma chamada ao Asaas por intenção", () => {
  it("fluxo normal: grava a intenção, cria o cliente e o checkout UMA vez e devolve o link", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => null, billing_set_customer: () => "cus_123456", billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }) });
    const asaas = asaasFake();
    const result = await startCheckout(deps(f.db, asaas), input());
    expect(result).toEqual({ status: "ready", intentId: "int-1", checkoutUrl: "https://sandbox.example.test/checkout/chk_123456", reused: false });
    expect(asaas.createCustomer).toHaveBeenCalledTimes(1);
    expect(asaas.createCustomer.mock.calls[0][0]).toMatchObject({ postalCode: "89223005", address: "Rua Teste", externalReference: "agency-1" });
    expect(asaas.createCheckout).toHaveBeenCalledTimes(1);
    expect(asaas.createCheckout.mock.calls[0][0]).toMatchObject({ customerId: "cus_123456", valueCents: 4990, cycle: "monthly", nextDueDate: "2026-10-15", minutesToExpire: 30, externalReference: "int-1" });
    expect(f.of("billing_mark_intent").map((call) => call.args.p_status)).toEqual(["dispatching", "awaiting_payment"]);
    expect(f.of("billing_mark_intent")[1].args).toMatchObject({ p_checkout_id: "chk_123456" });
  });
  it("o valor enviado ao Asaas vem do banco, nunca do navegador (a entrada nem aceita preço)", async () => {
    const f = fakeDb({ billing_create_intent: () => intent({ amount_cents: 4990 }), billing_get_customer: () => "cus_123456", billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }) });
    const asaas = asaasFake();
    await startCheckout(deps(f.db, asaas), { ...input(), amount: 1, valueCents: 1 } as StartCheckoutInput);
    expect(asaas.createCheckout.mock.calls[0][0].valueCents).toBe(4990);
    expect(f.of("billing_create_intent")[0].args).not.toHaveProperty("p_amount_cents");
  });
  it("cliente financeiro já existe: não busca dados pessoais nem recria", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => "cus_123456", billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }) });
    const asaas = asaasFake();
    const data = input();
    await startCheckout(deps(f.db, asaas), data);
    expect(data.loadCustomerData).not.toHaveBeenCalled();
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it("clique duplo / segunda aba / reenvio: intenção reaproveitada, Asaas NÃO é chamado de novo", async () => {
    const asaas = asaasFake();
    const ready = fakeDb({ billing_create_intent: () => intent({ reused: true, status: "awaiting_payment", checkout_url: "https://sandbox.example.test/c/1" }) });
    expect(await startCheckout(deps(ready.db, asaas), input())).toEqual({ status: "ready", intentId: "int-1", checkoutUrl: "https://sandbox.example.test/c/1", reused: true });
    const creating = fakeDb({ billing_create_intent: () => intent({ reused: true, status: "creating" }) });
    expect(await startCheckout(deps(creating.db, asaas), input())).toMatchObject({ status: "in_progress", reason: "creating", retryAfter: null });
    const unknown = fakeDb({ billing_create_intent: () => intent({ reused: true, status: "unknown" }) });
    expect(await startCheckout(deps(unknown.db, asaas), input())).toMatchObject({ status: "in_progress", reason: "verifying", retryAfter: "2026-10-15T15:32:00Z" });
    const dispatching = fakeDb({ billing_create_intent: () => intent({ reused: true, status: "dispatching" }) });
    expect(await startCheckout(deps(dispatching.db, asaas), input())).toMatchObject({ status: "in_progress", reason: "verifying" });
    expect(asaas.createCheckout).not.toHaveBeenCalled();
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it("timeout ao criar o checkout: marca 'desconhecida' e NÃO repete a criação", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => "cus_123456", billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }) });
    const asaas = asaasFake({ createCheckout: vi.fn(async () => { throw new AsaasError("x", null, "network", true, true, "t"); }) });
    const result = await startCheckout(deps(f.db, asaas), input());
    expect(result).toMatchObject({ status: "in_progress", reason: "verifying", retryAfter: "2026-10-15T15:32:00Z" });
    expect(f.of("billing_mark_intent").map((call) => call.args.p_status)).toEqual(["dispatching", "unknown"]);
    expect(asaas.createCheckout).toHaveBeenCalledTimes(1);
  });
  it("recusa definitiva do Asaas libera nova tentativa (intenção 'failed')", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => "cus_123456", billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }) });
    const asaas = asaasFake({ createCheckout: vi.fn(async () => { throw new AsaasError("x", 400, "invalid_action", false, false, "t"); }) });
    expect(await startCheckout(deps(f.db, asaas), input())).toEqual({ status: "rejected", reason: "unavailable" });
    expect(f.of("billing_mark_intent").map((call) => call.args.p_status)).toEqual(["dispatching", "failed"]);
  });
  it("falha ao criar o cliente financeiro não gera cobrança e libera nova tentativa", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => null, billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }) });
    const asaas = asaasFake({ createCustomer: vi.fn(async () => { throw new AsaasError("x", 503, null, true, true, "t"); }) });
    expect(await startCheckout(deps(f.db, asaas), input())).toEqual({ status: "rejected", reason: "unavailable" });
    expect(asaas.createCheckout).not.toHaveBeenCalled();
    expect(f.of("billing_mark_intent")[0].args.p_status).toBe("failed");
  });
  it("sem link no retorno do Asaas: fica aguardando, sem inventar endereço", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => "cus_123456", billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }) });
    const asaas = asaasFake({ createCheckout: vi.fn(async () => ({ id: "chk_123456", link: null })) });
    expect(await startCheckout(deps(f.db, asaas), input())).toMatchObject({ status: "in_progress", reason: "no_link" });
  });
  it("falha ao gravar o resultado depois que o Asaas respondeu: permanece protegida (nunca cria outra)", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => "cus_123456", billing_mark_intent: (args) => { if (args.p_status === "awaiting_payment") throw dbError("08006"); return { expires_at: "2026-10-15T15:32:00Z" }; } });
    const asaas = asaasFake();
    expect(await startCheckout(deps(f.db, asaas), input())).toMatchObject({ status: "in_progress", reason: "verifying", retryAfter: "2026-10-15T15:32:00Z" });
    expect(asaas.createCheckout).toHaveBeenCalledTimes(1);
  });
  it("se não for possível registrar o envio, NADA é enviado ao Asaas (a intenção é liberada em minutos)", async () => {
    const f = fakeDb({ billing_create_intent: () => intent(), billing_get_customer: () => "cus_123456", billing_mark_intent: () => { throw dbError("08006"); } });
    const asaas = asaasFake();
    expect(await startCheckout(deps(f.db, asaas), input())).toEqual({ status: "rejected", reason: "unavailable" });
    expect(asaas.createCheckout).not.toHaveBeenCalled();
  });
  it("mensagens claras para o cliente em cada situação", () => {
    expect(checkoutMessage({ status: "in_progress", intentId: "i", reason: "verifying", retryAfter: "2026-10-15T15:32:00Z" })).toMatch(/verificando sua contratação.*Não há nova cobrança.*depois das 12:32/);
    expect(checkoutMessage({ status: "in_progress", intentId: "i", reason: "verifying", retryAfter: null })).not.toMatch(/depois das/);
    expect(checkoutMessage({ status: "in_progress", intentId: "i", reason: "creating", retryAfter: null })).toMatch(/preparando/);
    expect(checkoutMessage({ status: "rejected", reason: "unavailable" })).toMatch(/Nada foi cobrado/);
    expect(checkoutMessage({ status: "rejected", reason: "forbidden" })).toMatch(/proprietário/);
    expect(checkoutMessage({ status: "rejected", reason: "already_subscribed" })).toMatch(/já possui uma assinatura/);
    expect(checkoutMessage({ status: "ready", intentId: "i", checkoutUrl: "https://x.test", reused: false })).toMatch(/Redirecionando/);
  });
  it.each([["42501", "forbidden"], ["23505", "already_subscribed"], ["22023", "invalid"], ["XX000", "unavailable"]])("erro %s do banco vira '%s' sem chamar o Asaas", async (code, reason) => {
    const f = fakeDb({ billing_create_intent: () => { throw dbError(code); } });
    const asaas = asaasFake();
    expect(await startCheckout(deps(f.db, asaas), input())).toEqual({ status: "rejected", reason });
    expect(asaas.createCheckout).not.toHaveBeenCalled();
  });
});

describe("cancelamento", () => {
  const requested = { subscription_id: "u1", asaas_subscription_id: "sub_123456", effective_at: "2026-11-15T00:00:00Z", environment: "sandbox", remote_cancel_pending: true, status: "active" };
  it("registra o pedido e interrompe a renovação no Asaas", async () => {
    const f = fakeDb({ billing_request_cancel: () => requested, billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake();
    expect(await cancelSubscriptionRequest(deps(f.db, asaas), { agencyId: "a", userId: "u" })).toEqual({ status: "requested", effectiveAt: "2026-11-15T00:00:00Z", remoteCancel: "done" });
    expect(asaas.cancelSubscription).toHaveBeenCalledWith("sub_123456");
    expect(f.of("billing_confirm_remote_cancel")).toHaveLength(1);
  });
  it("Asaas fora do ar: o cancelamento fica registrado e pendente (a reconciliação repete)", async () => {
    const f = fakeDb({ billing_request_cancel: () => requested, billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake({ cancelSubscription: vi.fn(async () => { throw new AsaasError("x", 503, null, true, true, "t"); }) });
    expect(await cancelSubscriptionRequest(deps(f.db, asaas), { agencyId: "a", userId: "u" })).toMatchObject({ status: "requested", remoteCancel: "pending" });
    expect(f.of("billing_confirm_remote_cancel")).toHaveLength(0);
  });
  it("assinatura já inexistente no Asaas conta como concluída", async () => {
    const f = fakeDb({ billing_request_cancel: () => requested, billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake({ cancelSubscription: vi.fn(async () => { throw new AsaasError("x", 404, null, false, false, "t"); }) });
    expect(await cancelSubscriptionRequest(deps(f.db, asaas), { agencyId: "a", userId: "u" })).toMatchObject({ remoteCancel: "done" });
  });
  it("quem não é o proprietário ou sem assinatura é recusado antes de qualquer chamada externa", async () => {
    const asaas = asaasFake();
    expect(await cancelSubscriptionRequest(deps(fakeDb({ billing_request_cancel: () => { throw dbError("42501"); } }).db, asaas), { agencyId: "a", userId: "u" })).toEqual({ status: "rejected", reason: "forbidden" });
    expect(await cancelSubscriptionRequest(deps(fakeDb({ billing_request_cancel: () => { throw dbError("22023"); } }).db, asaas), { agencyId: "a", userId: "u" })).toEqual({ status: "rejected", reason: "none" });
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
  });
});
