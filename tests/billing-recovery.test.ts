import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, type AsaasApi, type AsaasPayment, type AsaasSubscription } from "@/modules/billing/asaas-client";
import { startCheckout, type StartCheckoutInput } from "@/modules/billing/contracting";
import type { BillingDb } from "@/modules/billing/db";
import { processClaimedEvent, type BillingDeps, type ClaimedEvent } from "@/modules/billing/event-processor";
import { reconcileBilling, verifyBeforeContracting, verifyIntentWithAsaas } from "@/modules/billing/reconcile";
import { deriveContractView, parseBillingSnapshot, SLOW_CONFIRMATION_MS, type BillingSnapshot } from "@/modules/billing/status-view";

// Testes LOCAIS com bancos e Asaas simulados (nenhuma chamada real). A lógica de banco (vínculo, expiração, travas) é verificada em
// supabase/tests/billing-recovery.test.sql (PostgreSQL real em PGlite).

class RpcFail { constructor(readonly code: string) {} }
type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: BillingDb = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { code: "42883", message: "x" } };
      try { return { data: handler(args), error: null }; } catch (error) { if (error instanceof RpcFail) return { data: null, error: { code: error.code, message: "falhou" } }; throw error; }
    },
  };
  return { db, calls, of: (name: string) => calls.filter((call) => call.name === name) };
}
const sub = (patch: Partial<AsaasSubscription> = {}): AsaasSubscription => ({ id: "sub_123456", customer: "cus_123456", value: 49.9, cycle: "MONTHLY", status: "ACTIVE", billingType: "CREDIT_CARD", checkoutSession: "chk_123456", externalReference: null, ...patch });
const pay: AsaasPayment = { id: "pay_123456", subscription: "sub_123456", customer: "cus_123456", value: 49.9, dueDate: "2026-10-15", status: "CONFIRMED", billingType: "CREDIT_CARD" };
function asaasFake(overrides: Partial<AsaasApi> = {}) {
  return { createCustomer: vi.fn(), createCheckout: vi.fn(async () => ({ id: "chk_NOVO", link: "https://sandbox.example.test/novo" })), cancelSubscription: vi.fn(), getPayment: vi.fn(async () => pay), getSubscription: vi.fn(async () => sub()),
    listSubscriptionPayments: vi.fn(async () => [pay]), listCustomerSubscriptions: vi.fn(async () => [sub()]), ...overrides } as unknown as AsaasApi & Record<string, ReturnType<typeof vi.fn>>;
}
const deps = (db: BillingDb, asaas: AsaasApi): BillingDeps => ({ db, asaas, environment: "sandbox", now: () => new Date("2026-10-15T12:00:00Z") });
const item = (patch: Record<string, unknown> = {}) => ({ id: "int-1", environment: "sandbox", status: "expired", asaas_customer_id: "cus_123456", ...patch });
const down = () => new AsaasError("x", 503, null, false, true, "t");

describe("conferência de uma contratação no Asaas (fonte de verdade)", () => {
  it("2: pagamento confirmado depois da expiração local → a assinatura é registrada pelo caminho verificado, e as cobranças aplicadas", async () => {
    const f = fakeDb({ billing_apply_subscription: () => "created", billing_apply_payment: () => "activated", billing_mark_intent_verified: () => true });
    const result = await verifyIntentWithAsaas(deps(f.db, asaasFake()), item());
    expect(result).toEqual({ created: 1, verified: true });
    expect(f.of("billing_apply_subscription")[0].args.p_snapshot).toMatchObject({ id: "sub_123456", customer: "cus_123456", checkoutSession: "chk_123456" });
    expect(f.of("billing_apply_payment")[0].args.p_snapshot).toMatchObject({ id: "pay_123456", status: "CONFIRMED" });
  });
  it("só consulta o cliente financeiro DESTA organização (nada de outros clientes)", async () => {
    const asaas = asaasFake();
    await verifyIntentWithAsaas(deps(fakeDb({ billing_apply_subscription: () => "noop", billing_apply_payment: () => "noop_duplicate", billing_mark_intent_verified: () => true }).db, asaas), item({ asaas_customer_id: "cus_DONO_A01" }));
    expect(asaas.listCustomerSubscriptions).toHaveBeenCalledTimes(1);
    expect(asaas.listCustomerSubscriptions).toHaveBeenCalledWith("cus_DONO_A01", 100);
  });
  it("3: checkout expirado sem pagamento → nada é aplicado e a intenção é marcada como conferida (libera nova contratação)", async () => {
    const f = fakeDb({ billing_mark_intent_verified: () => true });
    const result = await verifyIntentWithAsaas(deps(f.db, asaasFake({ listCustomerSubscriptions: vi.fn(async () => []) })), item());
    expect(result).toEqual({ created: 0, verified: true });
    expect(f.of("billing_apply_subscription")).toHaveLength(0);
  });
  it("assinaturas encerradas no Asaas são ignoradas na conferência", async () => {
    const f = fakeDb({ billing_mark_intent_verified: () => true });
    const asaas = asaasFake({ listCustomerSubscriptions: vi.fn(async () => [sub({ deleted: true }), sub({ id: "sub_654321", status: "INACTIVE" })]) });
    await verifyIntentWithAsaas(deps(f.db, asaas), item());
    expect(f.of("billing_apply_subscription")).toHaveLength(0);
  });
  it("4/10: Asaas indisponível → NÃO marca como conferida (a contratação segue protegida) e o erro sobe para nova tentativa", async () => {
    const f = fakeDb({ billing_mark_intent_verified: () => true });
    const asaas = asaasFake({ listCustomerSubscriptions: vi.fn(async () => { throw down(); }) });
    await expect(verifyIntentWithAsaas(deps(f.db, asaas), item())).rejects.toBeInstanceOf(AsaasError);
    expect(f.of("billing_mark_intent_verified")).toHaveLength(0);
  });
  it("lista possivelmente incompleta (100 resultados) não libera nova contratação", async () => {
    const many = Array.from({ length: 100 }, (_, index) => sub({ id: `sub_${String(index).padStart(6, "0")}`, deleted: true }));
    const f = fakeDb({ billing_mark_intent_verified: () => true });
    expect((await verifyIntentWithAsaas(deps(f.db, asaasFake({ listCustomerSubscriptions: vi.fn(async () => many) })), item())).verified).toBe(false);
    expect(f.of("billing_mark_intent_verified")).toHaveLength(0);
  });
  it.each(["mismatch", "no_intent", "unlinked_candidate", "intent_closed", "duplicate_subscription", "unattributed"])(
    "8/15: assinatura com resultado '%s' (divergente, sem vínculo, ambígua ou duplicada) vai para revisão e NÃO libera nova contratação", async (outcome) => {
      const f = fakeDb({ billing_apply_subscription: () => outcome, billing_mark_intent_verified: () => true });
      const result = await verifyIntentWithAsaas(deps(f.db, asaasFake()), item());
      expect(result.verified).toBe(false);
      expect(f.of("billing_mark_intent_verified")).toHaveLength(0);
      expect(f.of("billing_apply_payment")).toHaveLength(0); // nenhuma cobrança é aplicada a uma assinatura não vinculada
    });
  it("intenção ainda em aberto (aguardando/desconhecida) só recupera assinatura; nunca marca como conferida", async () => {
    const f = fakeDb({ billing_apply_subscription: () => "noop", billing_apply_payment: () => "noop_duplicate", billing_mark_intent_verified: () => true });
    expect((await verifyIntentWithAsaas(deps(f.db, asaasFake()), item({ status: "awaiting_payment" }))).verified).toBe(false);
  });
});

describe("cron: reconciliação periódica recuperável", () => {
  const work = (intents: unknown[]) => ({ reconcile: [], remote_cancel: [], intents });
  it("recupera pagamento cujo webhook NUNCA foi gravado (consulta direta ao Asaas) e conta o resultado", async () => {
    const f = fakeDb({ billing_reconcile_work: () => work([item({ status: "awaiting_payment" })]), billing_apply_subscription: () => "created", billing_apply_payment: () => "activated" });
    const summary = await reconcileBilling(deps(f.db, asaasFake()));
    expect(summary).toMatchObject({ intentsChecked: 1, intentsResolved: 1, failed: 0 });
    expect(f.of("billing_apply_payment")).toHaveLength(1);
  });
  it("10: falha temporária do Asaas em uma intenção não interrompe as demais; a falha é contada e a próxima rodada tenta de novo", async () => {
    const list = vi.fn().mockRejectedValueOnce(down()).mockResolvedValueOnce([sub()]);
    const f = fakeDb({ billing_reconcile_work: () => work([item({ id: "a", status: "unknown" }), item({ id: "b", status: "unknown" })]), billing_apply_subscription: () => "created", billing_apply_payment: () => "activated" });
    const summary = await reconcileBilling(deps(f.db, asaasFake({ listCustomerSubscriptions: list })));
    expect(summary).toMatchObject({ intentsChecked: 1, failed: 1, intentsResolved: 1 });
  });
  it("11: após reinício do servidor basta o estado do banco: um novo processo recupera a mesma contratação", async () => {
    const state = { claimed: false };
    const handlers = { billing_reconcile_work: () => work(state.claimed ? [] : [item({ status: "expired" })]), billing_apply_subscription: () => "created", billing_apply_payment: () => "activated", billing_mark_intent_verified: () => true };
    const first = fakeDb(handlers);
    expect((await reconcileBilling(deps(first.db, asaasFake()))).intentsResolved).toBe(1);
    state.claimed = true;
    const second = fakeDb(handlers); // "novo processo": nenhuma memória da execução anterior
    expect((await reconcileBilling(deps(second.db, asaasFake()))).intentsChecked).toBe(0);
  });
  it("só confere intenções do ambiente configurado e respeita o tempo máximo", async () => {
    const asaas = asaasFake();
    const f = fakeDb({ billing_reconcile_work: () => work([item({ environment: "production" })]), billing_apply_subscription: () => "noop" });
    expect((await reconcileBilling(deps(f.db, asaas))).intentsChecked).toBe(0);
    expect(asaas.listCustomerSubscriptions).not.toHaveBeenCalled();
    const late = fakeDb({ billing_reconcile_work: () => work([item()]), billing_apply_subscription: () => "noop" });
    expect((await reconcileBilling(deps(late.db, asaas), { deadlineMs: Date.now() - 1 })).intentsChecked).toBe(0);
  });
  it("6: webhook (CHECKOUT_PAID) e cron ao mesmo tempo → a trava do banco devolve 'noop' ao segundo; nenhuma segunda assinatura no Asaas", async () => {
    let created = false;
    const f = fakeDb({
      billing_reconcile_work: () => work([item({ status: "awaiting_payment" })]),
      billing_intent_by_checkout: () => ({ intent_id: "int-1", agency_id: "ag-A", status: "awaiting_payment", asaas_customer_id: "cus_123456" }),
      billing_apply_subscription: () => { if (created) return "noop"; created = true; return "created"; },
      billing_apply_payment: () => "noop_duplicate",
    });
    const asaas = asaasFake();
    const event: ClaimedEvent = { id: 9, environment: "sandbox", asaas_event_id: "evt_x&1", event_type: "CHECKOUT_PAID", resource_type: "checkout", resource_id: "chk_123456", payload: {}, attempts: 1 } as ClaimedEvent;
    const [byEvent, byCron] = await Promise.all([processClaimedEvent(deps(f.db, asaas), event), reconcileBilling(deps(f.db, asaas))]);
    expect(byEvent.outcome).toBe("processed");
    expect(byCron.failed).toBe(0);
    expect(f.of("billing_apply_subscription")).toHaveLength(2);
    expect(created).toBe(true);
    expect(asaas.createCheckout).not.toHaveBeenCalled();
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
  });
});

describe("eventos do Asaas com resultados de recuperação", () => {
  const event = (type: string): ClaimedEvent => ({ id: 3, environment: "sandbox", asaas_event_id: "evt_05b708f961d739ea7eba7e4db318f621&368604920", event_type: type, resource_type: "checkout", resource_id: "chk_123456", payload: {}, attempts: 1 } as ClaimedEvent);
  const found = { intent_id: "int-1", agency_id: "ag-A", status: "expired", asaas_customer_id: "cus_123456" };
  it.each(["intent_closed", "ambiguous_intent", "duplicate_subscription", "mismatch"])("assinatura com resultado '%s' pede revisão humana (nunca ativa)", async (outcome) => {
    const f = fakeDb({ billing_intent_by_checkout: () => found, billing_apply_subscription: () => outcome, billing_apply_payment: () => "unknown_subscription" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_PAID"))).outcome).toBe("needs_review");
  });
  it("9: evento antigo chegando depois da ativação não desfaz nada (snapshot antigo é ignorado pelo banco)", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => ({ ...found, status: "completed" }), billing_apply_subscription: () => "noop", billing_apply_payment: () => "stale_snapshot" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_PAID"))).outcome).toBe("processed");
  });
  it("7: cobrança em duplicidade é idempotente", async () => {
    const f = fakeDb({ billing_intent_by_checkout: () => found, billing_apply_subscription: () => "noop", billing_apply_payment: () => "noop_duplicate" });
    expect((await processClaimedEvent(deps(f.db, asaasFake()), event("CHECKOUT_PAID"))).outcome).toBe("processed");
  });
});

describe("nova contratação não pode duplicar uma cobrança possivelmente paga", () => {
  const input = (): StartCheckoutInput => ({ agencyId: "ag-A", userId: "user-1", planVersionId: "pv-1", cycle: "monthly", requestKey: "chave-nova-0001", planName: "Profissional", urls: { successUrl: "https://x.test/ok", cancelUrl: "https://x.test/c", expiredUrl: "https://x.test/e" }, loadCustomerData: vi.fn() });
  const newIntent = { intent_id: "int-2", status: "creating", reused: false, asaas_checkout_id: null, checkout_url: null, amount_cents: 4990, checkout_minutes: 30, expires_at: null };
  it("5: enquanto a anterior ainda não foi conferida, NÃO cria outro checkout: mostra 'verificando'", async () => {
    const f = fakeDb({ billing_create_intent: () => { throw new RpcFail("55000"); }, billing_recovery_candidates: () => [{ id: "int-1", status: "expired", asaas_customer_id: "cus_123456" }] });
    const asaas = asaasFake({ listCustomerSubscriptions: vi.fn(async () => { throw down(); }) });
    expect(await startCheckout(deps(f.db, asaas), input())).toMatchObject({ status: "in_progress", reason: "verifying" });
    expect(asaas.createCheckout).not.toHaveBeenCalled();
    expect(f.of("billing_create_intent")).toHaveLength(1);
  });
  it("se a conferência mostra que a anterior foi paga, a nova contratação é recusada como 'já assinante' (sem novo checkout)", async () => {
    let attempt = 0;
    const f = fakeDb({
      billing_create_intent: () => { attempt += 1; throw new RpcFail(attempt === 1 ? "55000" : "23505"); },
      billing_recovery_candidates: () => [{ id: "int-1", status: "expired", asaas_customer_id: "cus_123456" }],
      billing_apply_subscription: () => "created", billing_apply_payment: () => "activated", billing_mark_intent_verified: () => true,
    });
    const asaas = asaasFake();
    expect(await startCheckout(deps(f.db, asaas), input())).toEqual({ status: "rejected", reason: "already_subscribed" });
    expect(asaas.createCheckout).not.toHaveBeenCalled();
  });
  it("conferida e sem pagamento: a nova contratação segue normalmente (uma tentativa de repetição só)", async () => {
    let attempt = 0;
    const f = fakeDb({
      billing_create_intent: () => { attempt += 1; if (attempt === 1) throw new RpcFail("55000"); return newIntent; },
      billing_recovery_candidates: () => [{ id: "int-1", status: "expired", asaas_customer_id: "cus_123456" }],
      billing_mark_intent_verified: () => true, billing_get_customer: () => "cus_123456",
      billing_mark_intent: () => ({ expires_at: "2026-10-15T12:32:00Z" }),
    });
    const asaas = asaasFake({ listCustomerSubscriptions: vi.fn(async () => []) });
    expect(await startCheckout(deps(f.db, asaas), input())).toMatchObject({ status: "ready", intentId: "int-2" });
    expect(f.of("billing_create_intent")).toHaveLength(2);
    expect(asaas.createCheckout).toHaveBeenCalledTimes(1);
  });
  it("verifyBeforeContracting: sem candidatas libera; Asaas fora do ar ou revisão pendente mantém bloqueado", async () => {
    expect(await verifyBeforeContracting(deps(fakeDb({ billing_recovery_candidates: () => [] }).db, asaasFake()), "ag-A")).toBe("clear");
    const base = { billing_recovery_candidates: () => [{ id: "int-1", status: "expired", asaas_customer_id: "cus_123456" }] };
    expect(await verifyBeforeContracting(deps(fakeDb({ ...base, billing_apply_subscription: () => "mismatch", billing_mark_intent_verified: () => true }).db, asaasFake()), "ag-A")).toBe("pending");
    expect(await verifyBeforeContracting(deps(fakeDb(base).db, asaasFake({ listCustomerSubscriptions: vi.fn(async () => { throw down(); }) })), "ag-A")).toBe("pending");
    expect(await verifyBeforeContracting(deps(fakeDb({}).db, asaasFake()), "ag-A")).toBe("pending"); // banco indisponível
  });
});

describe("tela de retorno: nunca fica 'verificando' para sempre nem incentiva pagar de novo", () => {
  const parse = (value: unknown) => parseBillingSnapshot(value) as BillingSnapshot;
  const awaiting = (patch: Record<string, unknown> = {}) => parse({ pending_checkout: { status: "awaiting_payment", cycle: "monthly", amount_cents: 4990, expires_at: "2026-10-15T12:32:00Z", dispatched_at: "2026-10-15T12:00:00Z", ...patch } });
  it("logo após voltar: verificando; depois do prazo razoável: confirmação em andamento, sem formulário de nova compra", () => {
    expect(deriveContractView(awaiting(), "ok", new Date("2026-10-15T12:02:00Z"))).toMatchObject({ state: "verifying_payment", polling: true });
    const slow = deriveContractView(awaiting(), "ok", new Date(new Date("2026-10-15T12:00:00Z").getTime() + SLOW_CONFIRMATION_MS + 1000));
    expect(slow).toMatchObject({ state: "recovering", polling: true });
    expect(slow.message).toMatch(/não pague de novo/i);
    expect(slow.message).not.toMatch(/recusad/i);
    expect(deriveContractView(awaiting({ dispatched_at: null }), "ok", new Date("2026-10-15T12:40:00Z")).state).toBe("recovering"); // além do prazo do checkout
  });
  it("intenção expirada mas ainda em conferência: 'confirmação em andamento' (nunca 'expirado')", () => {
    const view = deriveContractView(parse({ recovery: { since: "2026-10-15T12:32:00Z" }, last_intent: { status: "expired", at: "2026-10-15T12:32:00Z" } }), null, new Date("2026-10-15T12:40:00Z"));
    expect(view).toMatchObject({ state: "recovering", polling: true });
    expect(deriveContractView(parse({ recovery: { since: "2026-10-15T12:32:00Z" } }), "ok", new Date("2026-10-15T12:40:00Z")).state).toBe("recovering");
  });
  it("conferida e sem pagamento: 'expirado' (nova contratação permitida); com a dica de pagamento, explica que nada foi localizado", () => {
    expect(deriveContractView(parse({ last_intent: { status: "expired", at: "2026-10-15T12:32:00Z" } }), null).state).toBe("expired");
    const noPayment = deriveContractView(parse({ last_intent: { status: "expired", at: "2026-10-15T12:32:00Z" } }), "ok");
    expect(noPayment).toMatchObject({ state: "expired", polling: false });
    expect(noPayment.message).toMatch(/nada foi cobrado/i);
  });
  it("conflito financeiro exige atendimento, não manda pagar de novo e não afirma cancelamento ou reembolso", () => {
    const view = deriveContractView(parse({ conflict: true, subscription: { status: "active", cycle: "monthly", amount_cents: 4990 } }), null);
    expect(view).toMatchObject({ state: "conflict", polling: false });
    expect(view.message).toMatch(/não pague de novo/i);
    expect(view.message).toMatch(/nada foi cancelado ou reembolsado/i);
  });
  it("assinatura ativa continua confirmada; pagamento recusado continua exigindo assinatura criada e encerrada sem ativar", () => {
    expect(deriveContractView(parse({ subscription: { status: "active", cycle: "monthly", amount_cents: 4990, current_period_end: "2026-11-15T03:00:00Z" } }), "ok").state).toBe("confirmed");
    expect(deriveContractView(parse({ last_intent: { status: "expired", at: "2026-10-15T12:32:00Z" } }), "ok").state).not.toBe("refused");
  });
});

describe("sem liberação por decurso de prazo: o bloqueio nunca é silencioso", () => {
  const parse = (value: unknown) => parseBillingSnapshot(value) as BillingSnapshot;
  it("conferência em andamento há menos de 24 h: 'confirmação em andamento'; depois disso ou com revisão pendente: 'em análise', com orientação clara", () => {
    const since = "2026-10-15T12:00:00Z";
    expect(deriveContractView(parse({ recovery: { since } }), null, new Date("2026-10-15T20:00:00Z")).state).toBe("recovering");
    const late = deriveContractView(parse({ recovery: { since } }), null, new Date("2026-10-17T12:00:01Z"));
    expect(late).toMatchObject({ state: "attention", polling: false });
    const review = deriveContractView(parse({ recovery: { since, review: true } }), "ok", new Date("2026-10-15T12:05:00Z"));
    expect(review.state).toBe("attention");
    for (const view of [late, review]) {
      expect(view.message).toMatch(/não pague de novo/i);
      expect(view.message).toMatch(/suporte/i);
      expect(view.message).not.toMatch(/recusad/i);
    }
  });
});
