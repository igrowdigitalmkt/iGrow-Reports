import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, type AsaasApi, type AsaasPayment, type AsaasSubscription } from "@/modules/billing/asaas-client";
import type { BillingDb } from "@/modules/billing/db";
import { drainBillingEvents, processClaimedEvent, type BillingDeps, type ClaimedEvent } from "@/modules/billing/event-processor";
import { reconcileBilling } from "@/modules/billing/reconcile";

type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: BillingDb = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { code: "42883", message: `sem função ${name}` } };
      try { return { data: handler(args), error: null }; }
      catch (error) { return { data: null, error: { code: (error as { code?: string }).code ?? "XX000", message: (error as Error).message } }; }
    },
  };
  return { db, calls, of: (name: string) => calls.filter((call) => call.name === name) };
}

const payment: AsaasPayment = { id: "pay_123456", subscription: "sub_123456", customer: "cus_123456", value: 49.9, dueDate: "2026-10-15", status: "CONFIRMED", billingType: "CREDIT_CARD" };
const subscription: AsaasSubscription = { id: "sub_123456", customer: "cus_123456", value: 49.9, cycle: "MONTHLY", status: "ACTIVE", billingType: "CREDIT_CARD" };
const notFound = () => new AsaasError("404", 404, null, false, false, "t");

function asaasFake(overrides: Partial<AsaasApi> = {}) {
  const api = {
    createCustomer: vi.fn(), createCheckout: vi.fn(), cancelSubscription: vi.fn(async () => undefined),
    getPayment: vi.fn(async () => payment), getSubscription: vi.fn(async () => subscription), listSubscriptionPayments: vi.fn(async () => [payment]), listCustomerSubscriptions: vi.fn(async () => [] as AsaasSubscription[]),
    ...overrides,
  };
  return api as unknown as AsaasApi & typeof api;
}
const deps = (db: BillingDb, asaas: AsaasApi): BillingDeps => ({ db, asaas, environment: "sandbox", now: () => new Date("2026-10-15T12:00:00Z") });
const event = (patch: Partial<ClaimedEvent> = {}): ClaimedEvent => ({ id: 7, environment: "sandbox", asaas_event_id: "evt_123456", event_type: "PAYMENT_CONFIRMED", resource_type: "payment", resource_id: "pay_123456", payload: {}, attempts: 1, ...patch });

describe("processamento de eventos: o estado vem da API do Asaas, não do corpo do webhook", () => {
  it("confirma lendo o pagamento na API e aplicando o retrato verificado", async () => {
    const f = fakeDb({ billing_apply_payment: () => "activated" });
    const asaas = asaasFake();
    const result = await processClaimedEvent(deps(f.db, asaas), event({ payload: { payment: { status: "CONFIRMED", value: 1 } } }));
    expect(result.outcome).toBe("processed");
    expect(asaas.getPayment).toHaveBeenCalledWith("pay_123456");
    const snapshot = f.of("billing_apply_payment")[0].args.p_snapshot as Record<string, unknown>;
    expect(snapshot).toMatchObject({ id: "pay_123456", value: 49.9, status: "CONFIRMED", billingType: "CREDIT_CARD", observedAt: "2026-10-15T12:00:00.000Z" });
    expect(f.of("billing_apply_payment")[0].args).toMatchObject({ p_environment: "sandbox", p_event_id: 7, p_signal: null });
  });
  it("um corpo de evento que mente (valor/status) não influencia: só a API conta", async () => {
    const f = fakeDb({ billing_apply_payment: () => "recorded_only" });
    const asaas = asaasFake({ getPayment: vi.fn(async () => ({ ...payment, status: "PENDING" })) });
    await processClaimedEvent(deps(f.db, asaas), event({ payload: { payment: { status: "CONFIRMED", value: 0.01 } } }));
    expect(f.of("billing_apply_payment")[0].args.p_snapshot).toMatchObject({ status: "PENDING", value: 49.9 });
  });
  it("recusa quando a API devolve outro pagamento", async () => {
    const f = fakeDb({ billing_apply_payment: () => "activated" });
    const result = await processClaimedEvent(deps(f.db, asaasFake({ getPayment: vi.fn(async () => ({ ...payment, id: "pay_outro99" })) })), event());
    expect(result.outcome).toBe("needs_review");
    expect(f.of("billing_apply_payment")).toHaveLength(0);
  });
  it("falha de captura do cartão envia o sinal ao banco", async () => {
    const f = fakeDb({ billing_apply_payment: () => "past_due" });
    await processClaimedEvent(deps(f.db, asaasFake()), event({ event_type: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED" }));
    expect(f.of("billing_apply_payment")[0].args.p_signal).toBe("capture_refused");
  });
  it("assinatura desconhecida: lê e registra a assinatura e reaplica o pagamento", async () => {
    let first = true;
    const f = fakeDb({ billing_apply_payment: () => { if (first) { first = false; return "unknown_subscription"; } return "activated"; }, billing_apply_subscription: () => "created" });
    const asaas = asaasFake();
    const result = await processClaimedEvent(deps(f.db, asaas), event());
    expect(result.outcome).toBe("processed");
    expect(asaas.getSubscription).toHaveBeenCalledWith("sub_123456");
    expect(f.of("billing_apply_subscription")).toHaveLength(1);
    expect(f.of("billing_apply_payment")).toHaveLength(2);
  });
  it("assinatura continua desconhecida: tenta de novo e depois pede revisão", async () => {
    const f = fakeDb({ billing_apply_payment: () => "unknown_subscription", billing_apply_subscription: () => "unattributed" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event({ attempts: 1 }))).outcome).toBe("retry");
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event({ attempts: 4 }))).outcome).toBe("needs_review");
  });
  it.each(["mismatch", "duplicate_subscription", "unattributed", "needs_review", "no_intent", "payment_for_canceled"])("resultado '%s' do banco vai para revisão humana", async (outcome) => {
    const f = fakeDb({ billing_apply_payment: () => outcome });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event())).outcome).toBe("needs_review");
  });
  it.each(["noop_duplicate", "stale_snapshot", "recorded_only", "activated", "past_due", "activation_failed"])("resultado '%s' do banco conclui o evento", async (outcome) => {
    const f = fakeDb({ billing_apply_payment: () => outcome });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event())).outcome).toBe("processed");
  });
  it("cobrança removida no Asaas (PAYMENT_DELETED) que não existe mais é ignorada; outro evento sem objeto vai para revisão", async () => {
    const gone = asaasFake({ getPayment: vi.fn(async () => { throw notFound(); }) });
    expect((await processClaimedEvent(deps(fakeDb({}).db, gone), event({ event_type: "PAYMENT_DELETED" }))).outcome).toBe("ignored");
    expect((await processClaimedEvent(deps(fakeDb({}).db, gone), event({ event_type: "PAYMENT_CONFIRMED" }))).outcome).toBe("needs_review");
  });
  it("eventos informativos, de checkout e desconhecidos não têm efeito financeiro", async () => {
    const f = fakeDb({});
    const asaas = asaasFake();
    expect((await processClaimedEvent(deps(f.db, asaas), event({ event_type: "PAYMENT_BANK_SLIP_VIEWED" }))).outcome).toBe("ignored");
    expect((await processClaimedEvent(deps(f.db, asaas), event({ event_type: "CHECKOUT_CREATED", resource_type: "checkout", resource_id: "chk_123456" }))).outcome).toBe("ignored");
    expect((await processClaimedEvent(deps(f.db, asaas), event({ event_type: "ALGO_NOVO", resource_type: "other", resource_id: null }))).outcome).toBe("ignored");
    expect(asaas.getPayment).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
  });
  it("evento de outro ambiente nunca é processado", async () => {
    const f = fakeDb({});
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event({ environment: "production" }))).outcome).toBe("needs_review");
    expect(f.calls).toHaveLength(0);
  });
  it("assinatura removida: o evento de remoção funciona mesmo quando o objeto já não existe", async () => {
    const f = fakeDb({ billing_apply_subscription: () => "cancel_recorded" });
    const asaas = asaasFake({ getSubscription: vi.fn(async () => { throw notFound(); }) });
    const result = await processClaimedEvent(deps(f.db, asaas), event({ event_type: "SUBSCRIPTION_DELETED", resource_type: "subscription", resource_id: "sub_123456" }));
    expect(result.outcome).toBe("processed");
    expect(f.of("billing_apply_subscription")[0].args.p_snapshot).toEqual({ id: "sub_123456", deleted: true });
  });
  it("outros eventos de assinatura sem objeto no Asaas pedem revisão", async () => {
    const f = fakeDb({});
    const asaas = asaasFake({ getSubscription: vi.fn(async () => { throw notFound(); }) });
    expect((await processClaimedEvent(deps(f.db, asaas), event({ event_type: "SUBSCRIPTION_UPDATED", resource_type: "subscription", resource_id: "sub_123456" }))).outcome).toBe("needs_review");
  });
  it("falhas transitórias (Asaas fora, não autorizado, banco) viram nova tentativa; nada é perdido", async () => {
    const down = asaasFake({ getPayment: vi.fn(async () => { throw new AsaasError("x", 503, null, false, true, "t"); }) });
    expect((await processClaimedEvent(deps(fakeDb({}).db, down), event())).outcome).toBe("retry");
    const denied = asaasFake({ getPayment: vi.fn(async () => { throw new AsaasError("x", 401, null, false, false, "t"); }) });
    expect((await processClaimedEvent(deps(fakeDb({}).db, denied), event())).outcome).toBe("retry");
    const dbDown = fakeDb({ billing_apply_payment: () => { throw Object.assign(new Error("indisponível"), { code: "08006" }); } });
    expect((await processClaimedEvent(deps(dbDown.db, asaasFake()), event())).outcome).toBe("retry");
    const gone = asaasFake({ getPayment: vi.fn(async () => { throw notFound(); }) });
    expect((await processClaimedEvent(deps(fakeDb({}).db, gone), event())).outcome).toBe("needs_review");
  });
  it("o detalhe gravado nunca contém a chave nem o corpo", async () => {
    const secret = "$aact_hmlg_SEGREDO";
    const asaas = asaasFake({ getPayment: vi.fn(async () => { throw new AsaasError(`falhou com ${secret}`, 500, "x", false, true, "t"); }) });
    const result = await processClaimedEvent(deps(fakeDb({}).db, asaas), event());
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("fila de eventos recuperável", () => {
  it("reserva, processa e registra o resultado de cada evento", async () => {
    const events = [event({ id: 1 }), event({ id: 2, event_type: "PAYMENT_BANK_SLIP_VIEWED" }), event({ id: 3, resource_id: "pay_falha01" })];
    const f = fakeDb({ billing_claim_events: () => events, billing_apply_payment: () => "activated", billing_finish_event: () => null });
    const asaas = asaasFake({ getPayment: vi.fn(async (id: string) => { if (id === "pay_falha01") throw new AsaasError("x", 503, null, false, true, "t"); return payment; }) });
    const summary = await drainBillingEvents(deps(f.db, asaas), { limit: 5 });
    expect(summary).toEqual({ claimed: 3, processed: 1, ignored: 1, needs_review: 0, retry: 1, deferred: 0 });
    expect(f.of("billing_finish_event").map((call) => [call.args.p_id, call.args.p_outcome])).toEqual([[1, "processed"], [2, "ignored"], [3, "retry"]]);
  });
  it("sem tempo restante, não inicia novos processamentos (a reserva vence e outro processo retoma)", async () => {
    const f = fakeDb({ billing_claim_events: () => [event({ id: 1 }), event({ id: 2 })], billing_apply_payment: () => "activated", billing_finish_event: () => null });
    const asaas = asaasFake();
    const summary = await drainBillingEvents(deps(f.db, asaas), { deadlineMs: Date.now() - 1 });
    expect(summary).toMatchObject({ claimed: 2, processed: 0, deferred: 2 });
    expect(asaas.getPayment).not.toHaveBeenCalled();
    expect(f.of("billing_finish_event")).toHaveLength(0);
  });
  it("evento específico (processamento imediato) reserva só aquele evento", async () => {
    const f = fakeDb({ billing_claim_events: () => [], billing_finish_event: () => null });
    await drainBillingEvents(deps(f.db, asaasFake()), { limit: 1, eventId: 42 });
    expect(f.of("billing_claim_events")[0].args).toMatchObject({ p_limit: 1, p_event_id: 42 });
  });
  it("se registrar o resultado falhar, não derruba o lote (a reserva vence e outro processo retoma)", async () => {
    const f = fakeDb({ billing_claim_events: () => [event({ id: 1 }), event({ id: 2 })], billing_apply_payment: () => "activated", billing_finish_event: () => { throw new Error("fora"); } });
    const summary = await drainBillingEvents(deps(f.db, asaasFake()), {});
    expect(summary.claimed).toBe(2);
    expect(summary.processed).toBe(2);
  });
  it("falha ao reservar propaga o erro (a rotina tenta de novo na próxima execução)", async () => {
    const f = fakeDb({ billing_claim_events: () => { throw new Error("banco fora"); } });
    await expect(drainBillingEvents(deps(f.db, asaasFake()), {})).rejects.toThrow();
  });
});

describe("reconciliação com o Asaas", () => {
  it("reaplica o estado real das assinaturas e marca como conferidas", async () => {
    const f = fakeDb({
      billing_reconcile_work: () => ({ reconcile: [{ id: "u1", environment: "sandbox", asaas_subscription_id: "sub_123456" }], remote_cancel: [] }),
      billing_apply_subscription: () => "noop", billing_apply_payment: () => "noop_duplicate", billing_mark_reconciled: () => null,
    });
    const asaas = asaasFake({ listSubscriptionPayments: vi.fn(async () => [{ ...payment, id: "pay_222222", dueDate: "2026-11-15" }, payment]) });
    const summary = await reconcileBilling(deps(f.db, asaas), {});
    expect(summary).toEqual({ checked: 1, remoteCanceled: 0, failed: 0, intentsChecked: 0, intentsResolved: 0 });
    expect(f.of("billing_apply_payment").map((call) => (call.args.p_snapshot as { id: string }).id)).toEqual(["pay_123456", "pay_222222"]); // cronológico
    expect(f.of("billing_mark_reconciled")).toHaveLength(1);
  });
  it("assinatura que sumiu do Asaas é reaplicada como removida", async () => {
    const f = fakeDb({
      billing_reconcile_work: () => ({ reconcile: [{ id: "u1", environment: "sandbox", asaas_subscription_id: "sub_123456" }], remote_cancel: [] }),
      billing_apply_subscription: () => "cancel_recorded", billing_apply_payment: () => "noop", billing_mark_reconciled: () => null,
    });
    const asaas = asaasFake({ getSubscription: vi.fn(async () => { throw notFound(); }) });
    await reconcileBilling(deps(f.db, asaas), {});
    expect(f.of("billing_apply_subscription")[0].args.p_snapshot).toEqual({ id: "sub_123456", deleted: true });
  });
  it("conclui cancelamentos pendentes no Asaas e repete os que falharem", async () => {
    const f = fakeDb({
      billing_reconcile_work: () => ({ reconcile: [], remote_cancel: [{ id: "u1", environment: "sandbox", asaas_subscription_id: "sub_aaaaaa" }, { id: "u2", environment: "sandbox", asaas_subscription_id: "sub_bbbbbb" }, { id: "u3", environment: "sandbox", asaas_subscription_id: "sub_cccccc" }] }),
      billing_confirm_remote_cancel: () => null,
    });
    const asaas = asaasFake({ cancelSubscription: vi.fn(async (id: string) => { if (id === "sub_bbbbbb") throw new AsaasError("x", 503, null, true, true, "t"); if (id === "sub_cccccc") throw notFound(); }) });
    const summary = await reconcileBilling(deps(f.db, asaas), {});
    expect(summary).toEqual({ checked: 0, remoteCanceled: 2, failed: 1, intentsChecked: 0, intentsResolved: 0 });
    expect(f.of("billing_confirm_remote_cancel").map((call) => call.args.p_subscription_id)).toEqual(["u1", "u3"]);
  });
  it("contratação com resultado desconhecido: consulta o Asaas e registra a assinatura se ela já existir", async () => {
    const f = fakeDb({
      billing_reconcile_work: () => ({ reconcile: [], remote_cancel: [], intents: [{ id: "i1", environment: "sandbox", asaas_customer_id: "cus_123456" }] }),
      billing_apply_subscription: () => "created",
    });
    const asaas = asaasFake({ listCustomerSubscriptions: vi.fn(async () => [subscription, { ...subscription, id: "sub_removida", deleted: true }]) });
    const summary = await reconcileBilling(deps(f.db, asaas), {});
    expect(summary).toMatchObject({ intentsChecked: 1, intentsResolved: 1, failed: 0 });
    expect(asaas.listCustomerSubscriptions).toHaveBeenCalledWith("cus_123456", 20);
    expect(f.of("billing_apply_subscription")).toHaveLength(1); // assinatura removida não é aplicada
  });
  it("sem assinatura no Asaas, a intenção desconhecida não é alterada (só expira com o checkout)", async () => {
    const f = fakeDb({ billing_reconcile_work: () => ({ reconcile: [], remote_cancel: [], intents: [{ id: "i1", environment: "sandbox", asaas_customer_id: "cus_123456" }] }) });
    const summary = await reconcileBilling(deps(f.db, asaasFake()), {});
    expect(summary).toMatchObject({ intentsChecked: 1, intentsResolved: 0 });
    expect(f.of("billing_apply_subscription")).toHaveLength(0);
    expect(f.calls.map((call) => call.name)).toEqual(["billing_reconcile_work"]);
  });
  it("falha ao consultar uma contratação desconhecida é contada e não derruba a rotina", async () => {
    const f = fakeDb({ billing_reconcile_work: () => ({ reconcile: [], remote_cancel: [], intents: [{ id: "i1", environment: "sandbox", asaas_customer_id: "cus_123456" }] }) });
    const asaas = asaasFake({ listCustomerSubscriptions: vi.fn(async () => { throw new AsaasError("x", 503, null, false, true, "t"); }) });
    expect(await reconcileBilling(deps(f.db, asaas), {})).toMatchObject({ failed: 1, intentsChecked: 0 });
  });
  it("sem tempo restante, a reconciliação não inicia consultas ao Asaas", async () => {
    const f = fakeDb({ billing_reconcile_work: () => ({ reconcile: [{ id: "u1", environment: "sandbox", asaas_subscription_id: "sub_123456" }], remote_cancel: [{ id: "u2", environment: "sandbox", asaas_subscription_id: "sub_654321" }], intents: [{ id: "i1", environment: "sandbox", asaas_customer_id: "cus_123456" }] }) });
    const asaas = asaasFake();
    expect(await reconcileBilling(deps(f.db, asaas), { deadlineMs: Date.now() - 1 })).toMatchObject({ checked: 0, remoteCanceled: 0, intentsChecked: 0 });
    expect(asaas.getSubscription).not.toHaveBeenCalled();
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
    expect(asaas.listCustomerSubscriptions).not.toHaveBeenCalled();
  });
  it("ignora itens de outro ambiente", async () => {
    const f = fakeDb({ billing_reconcile_work: () => ({ reconcile: [{ id: "u1", environment: "production", asaas_subscription_id: "sub_123456" }], remote_cancel: [{ id: "u2", environment: "production", asaas_subscription_id: "sub_654321" }] }) });
    const asaas = asaasFake();
    expect(await reconcileBilling(deps(f.db, asaas), {})).toEqual({ checked: 0, remoteCanceled: 0, failed: 0, intentsChecked: 0, intentsResolved: 0 });
    expect(asaas.getSubscription).not.toHaveBeenCalled();
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
  });
});
