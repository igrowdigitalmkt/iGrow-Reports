import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, type AsaasApi, type AsaasPayment, type AsaasSubscription } from "@/modules/billing/asaas-client";
import type { BillingDb } from "@/modules/billing/db";
import { processClaimedEvent, subscriptionSnapshot, type BillingDeps, type ClaimedEvent } from "@/modules/billing/event-processor";

type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: BillingDb = { async rpc(name, args = {}) { calls.push({ name, args }); const handler = handlers[name]; if (!handler) return { data: null, error: { code: "42883", message: "x" } }; return { data: handler(args), error: null }; } };
  return { db, calls, of: (name: string) => calls.filter((call) => call.name === name) };
}
const subscription: AsaasSubscription = { id: "sub_123456", customer: "cus_123456", value: 49.9, cycle: "MONTHLY", status: "ACTIVE", billingType: "CREDIT_CARD", checkoutSession: "chk_123456", externalReference: "int-uuid" };
const payment: AsaasPayment = { id: "pay_123456", subscription: "sub_123456", customer: "cus_123456", value: 49.9, dueDate: "2026-10-15", status: "CONFIRMED", billingType: "CREDIT_CARD" };
function asaasFake(overrides: Partial<AsaasApi> = {}) {
  return { createCustomer: vi.fn(), createCheckout: vi.fn(), cancelSubscription: vi.fn(), getPayment: vi.fn(async () => payment), getSubscription: vi.fn(async () => subscription),
    listSubscriptionPayments: vi.fn(async () => [payment]), listCustomerSubscriptions: vi.fn(async () => [subscription]), ...overrides } as unknown as AsaasApi & Record<string, ReturnType<typeof vi.fn>>;
}
const deps = (db: BillingDb, asaas: AsaasApi): BillingDeps => ({ db, asaas, environment: "sandbox", now: () => new Date("2026-10-15T12:00:00Z") });
const event = (type: string, patch: Partial<ClaimedEvent> = {}): ClaimedEvent => ({ id: 5, environment: "sandbox", asaas_event_id: "evt_checkout1", event_type: type, resource_type: "checkout", resource_id: "chk_123456", payload: {}, attempts: 1, ...patch });
const found = { intent_id: "int-1", agency_id: "agency-A", status: "awaiting_payment", asaas_customer_id: "cus_123456" };

describe("eventos do checkout hospedado: nenhum ativa nada por si só", () => {
  it("CHECKOUT_PAID dispara a VERIFICAÇÃO: lê as assinaturas do cliente DESTA intenção na API e aplica pelo caminho verificado", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => found, billing_apply_subscription: () => "created", billing_apply_payment: () => "activated" });
    const asaas = asaasFake();
    const result = await processClaimedEvent(deps(f.db, asaas), event("CHECKOUT_PAID", { payload: { checkout: { id: "chk_123456" } } }));
    expect(result.outcome).toBe("processed");
    expect(asaas.listCustomerSubscriptions).toHaveBeenCalledWith("cus_123456", 20);
    expect(f.of("billing_apply_subscription")[0].args.p_snapshot).toMatchObject({ id: "sub_123456", customer: "cus_123456", checkoutSession: "chk_123456", externalReference: "int-uuid" });
    expect(f.of("billing_apply_payment")[0].args.p_snapshot).toMatchObject({ id: "pay_123456", status: "CONFIRMED" });
    expect(f.of("billing_intent_by_checkout")[0].args).toEqual({ p_environment: "sandbox", p_checkout_id: "chk_123456" });
  });
  it("só consulta o cliente da intenção: nada de outro cliente ou organização entra", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => ({ ...found, asaas_customer_id: "cus_DONO_B01" }), billing_apply_subscription: () => "noop", billing_apply_payment: () => "noop_duplicate" });
    const asaas = asaasFake();
    await processClaimedEvent(deps(f.db, asaas), event("CHECKOUT_PAID"));
    expect(asaas.listCustomerSubscriptions).toHaveBeenCalledTimes(1);
    expect(asaas.listCustomerSubscriptions).toHaveBeenCalledWith("cus_DONO_B01", 20);
  });
  it("o corpo do evento nunca é a prova: sem resposta da API não há ativação", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => found, billing_apply_subscription: () => "created", billing_apply_payment: () => "activated" });
    const asaas = asaasFake({ listCustomerSubscriptions: vi.fn(async () => { throw new AsaasError("x", 503, null, false, true, "t"); }) });
    expect((await processClaimedEvent(deps(f.db, asaas), event("CHECKOUT_PAID", { payload: { checkout: { id: "chk_123456", status: "PAID" } } }))).outcome).toBe("retry");
    expect(f.of("billing_apply_subscription")).toHaveLength(0);
    expect(f.of("billing_apply_payment")).toHaveLength(0);
  });
  it("checkout pago ainda sem assinatura visível: tenta de novo e depois pede revisão humana", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => found });
    const empty = asaasFake({ listCustomerSubscriptions: vi.fn(async () => []) });
    expect((await processClaimedEvent(deps(f.db, empty), event("CHECKOUT_PAID", { attempts: 1 }))).outcome).toBe("retry");
    expect((await processClaimedEvent(deps(f.db, empty), event("CHECKOUT_PAID", { attempts: 4 }))).outcome).toBe("needs_review");
    const removed = asaasFake({ listCustomerSubscriptions: vi.fn(async () => [{ ...subscription, deleted: true }, { ...subscription, id: "sub_654321", status: "INACTIVE" }]) });
    expect((await processClaimedEvent(deps(f.db, removed), event("CHECKOUT_PAID", { attempts: 1 }))).outcome).toBe("retry");
  });
  it("checkout desconhecido: espera a gravação do identificador e depois pede revisão", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => null });
    const asaas = asaasFake();
    expect((await processClaimedEvent(deps(f.db, asaas), event("CHECKOUT_PAID", { attempts: 2 }))).outcome).toBe("retry");
    expect((await processClaimedEvent(deps(f.db, asaas), event("CHECKOUT_PAID", { attempts: 4 }))).outcome).toBe("needs_review");
    expect(asaas.listCustomerSubscriptions).not.toHaveBeenCalled();
  });
  it("vínculo divergente (outro checkout/referência) vai para revisão e nunca ativa", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => found, billing_apply_subscription: () => "mismatch" });
    const result = await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_PAID"));
    expect(result.outcome).toBe("needs_review");
    expect(f.of("billing_apply_payment")).toHaveLength(0);
  });
  it("assinatura duplicada na mesma organização vai para revisão", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => found, billing_apply_subscription: () => "duplicate_subscription" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_PAID"))).outcome).toBe("needs_review");
  });
  it("CHECKOUT_PAID repetido: tudo idempotente (noop) e concluído", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => ({ ...found, status: "completed" }), billing_apply_subscription: () => "noop", billing_apply_payment: () => "noop_duplicate" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_PAID"))).outcome).toBe("processed");
  });
  it("CHECKOUT_CANCELED e CHECKOUT_EXPIRED fecham só a intenção em aberto", async () => {
    const f = fakeDb({ billing_close_intent: () => "closed" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_CANCELED"))).outcome).toBe("processed");
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_EXPIRED"))).outcome).toBe("processed");
    expect(f.of("billing_close_intent").map((call) => call.args.p_status)).toEqual(["canceled", "expired"]);
    const done = fakeDb({ billing_close_intent: () => "already_completed" });
    expect((await processClaimedEvent(deps(done.db, asaasFake()), event("CHECKOUT_EXPIRED"))).outcome).toBe("processed");
  });
  it("cancelamento/expiração de checkout desconhecido: tenta de novo e depois pede revisão", async () => {
    const f = fakeDb({ billing_close_intent: () => "unknown_checkout" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_CANCELED", { attempts: 1 }))).outcome).toBe("retry");
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_CANCELED", { attempts: 4 }))).outcome).toBe("needs_review");
  });
  it("CHECKOUT_CREATED e eventos desconhecidos de checkout são só informativos", async () => {
    const f = fakeDb({});
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_CREATED"))).outcome).toBe("ignored");
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_ALGO_NOVO"))).outcome).toBe("ignored");
    expect(f.calls).toHaveLength(0);
  });
});

describe("retrato da assinatura", () => {
  it("leva o identificador do checkout e a referência externa para a conferência no banco", () => {
    expect(subscriptionSnapshot(subscription)).toMatchObject({ checkoutSession: "chk_123456", externalReference: "int-uuid" });
    expect(subscriptionSnapshot({ ...subscription, checkoutSession: undefined, externalReference: undefined })).toMatchObject({ checkoutSession: null, externalReference: null });
  });
});
