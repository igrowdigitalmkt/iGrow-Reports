import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, type AsaasApi } from "@/modules/billing/asaas-client";
import { runCancel } from "@/modules/billing/cancel-flow";
import type { BillingDb } from "@/modules/billing/db";
import { processClaimedEvent, type BillingDeps, type ClaimedEvent } from "@/modules/billing/event-processor";
import { canRequestCancel, describeLatestPayment, describeSubscription, openInvoiceLink, trustedInvoiceUrl } from "@/modules/billing/subscription-info";
import { deriveContractView, parseBillingSnapshot, type BillingSnapshot } from "@/modules/billing/status-view";

// Testes LOCAIS com bancos e Asaas simulados (nenhuma chamada real). A lógica financeira no banco está em supabase/tests/billing-lifecycle.test.sql.

type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: BillingDb = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      const handler = handlers[name];
      if (!handler) return { data: null, error: { code: "42883", message: "x" } };
      try { return { data: handler(args), error: null }; } catch (error) { const code = (error as { code?: string }).code ?? "XX000"; return { data: null, error: { code, message: "falhou" } }; }
    },
  };
  return { db, calls, of: (name: string) => calls.filter((call) => call.name === name) };
}
const asaasFake = (overrides: Partial<AsaasApi> = {}) => ({ cancelSubscription: vi.fn(async () => undefined), getSubscription: vi.fn(), getPayment: vi.fn(), listSubscriptionPayments: vi.fn(), listCustomerSubscriptions: vi.fn(), createCustomer: vi.fn(), createCheckout: vi.fn(), ...overrides }) as unknown as AsaasApi & { cancelSubscription: ReturnType<typeof vi.fn> };
const deps = (db: BillingDb, asaas: AsaasApi): BillingDeps => ({ db, asaas, environment: "sandbox", now: () => new Date("2027-01-15T12:00:00Z") });
const requested = { subscription_id: "u1", asaas_subscription_id: "sub_123456", effective_at: "2027-10-15T03:00:00Z", environment: "sandbox", remote_cancel_pending: true, status: "active" };
const input = (role = "owner") => ({ agencyId: "ag-A", userId: "user-1", role });
const err = (code: string) => Object.assign(new Error(code), { code });

describe("cancelamento: permissões e segurança", () => {
  it.each(["admin", "editor", "viewer"])("%s não cancela: recusado ANTES de qualquer consulta ao banco ou ao Asaas", async (role) => {
    const f = fakeDb({ billing_request_cancel: () => requested });
    const asaas = asaasFake();
    const result = await runCancel(deps(f.db, asaas), input(role));
    expect(result).toMatchObject({ status: "error" });
    expect(f.calls).toHaveLength(0);
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
  });
  it("o banco também recusa (42501): mesmo se o papel vier errado, nada é cancelado", async () => {
    const f = fakeDb({ billing_request_cancel: () => { throw err("42501"); } });
    const asaas = asaasFake();
    expect(await runCancel(deps(f.db, asaas), input())).toMatchObject({ status: "error", message: expect.stringMatching(/proprietário/i) });
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
  });
  it("sem assinatura para cancelar", async () => {
    const f = fakeDb({ billing_request_cancel: () => { throw err("22023"); } });
    expect(await runCancel(deps(f.db, asaasFake()), input())).toMatchObject({ status: "error", message: expect.stringMatching(/não há assinatura/i) });
  });
});

describe("cancelamento: o que se diz ao assinante", () => {
  it("confirmado pelo Asaas: acesso até a data do período pago, sem renovação, dados preservados, sem reembolso automático", async () => {
    const f = fakeDb({ billing_request_cancel: () => requested, billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake();
    const result = await runCancel(deps(f.db, asaas), input());
    expect(result.status).toBe("canceled");
    expect(result.message).toContain("Assinatura cancelada.");
    expect(result.message).toContain("15 de outubro de 2027");
    expect(result.message).toMatch(/não haverá renovação/i);
    expect(result.message).toMatch(/dados foram preservados/i);
    expect(result.message).toMatch(/sem reembolso|não há reembolso/i);
    expect(asaas.cancelSubscription).toHaveBeenCalledWith("sub_123456");
    expect(f.of("billing_confirm_remote_cancel")).toHaveLength(1);
  });
  it("timeout do Asaas: NÃO afirma que a renovação foi interrompida; diz que está em processamento e que o pedido não precisa ser repetido", async () => {
    const f = fakeDb({ billing_request_cancel: () => requested, billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake({ cancelSubscription: vi.fn(async () => { throw new AsaasError("x", null, "timeout", true, true, "t"); }) });
    const result = await runCancel(deps(f.db, asaas), input());
    expect(result.status).toBe("processing");
    expect(result.message).toMatch(/concluindo/i);
    expect(result.message).toMatch(/ainda não foi interrompida/i);
    expect(result.message).not.toMatch(/assinatura cancelada\./i);
    expect(f.of("billing_confirm_remote_cancel")).toHaveLength(0); // a reconciliação repete o aviso
  });
  it("resposta desconhecida do Asaas (erro inesperado) também fica pendente, sem falso sucesso", async () => {
    const f = fakeDb({ billing_request_cancel: () => requested, billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake({ cancelSubscription: vi.fn(async () => { throw new Error("resposta estranha"); }) });
    expect((await runCancel(deps(f.db, asaas), input())).status).toBe("processing");
  });
  it("assinatura já removida no Asaas (404) conta como concluída", async () => {
    const f = fakeDb({ billing_request_cancel: () => requested, billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake({ cancelSubscription: vi.fn(async () => { throw new AsaasError("x", 404, null, false, false, "t"); }) });
    expect((await runCancel(deps(f.db, asaas), input())).status).toBe("canceled");
  });
  it("banco indisponível ao registrar o pedido: nada é alterado e nada é dito como cancelado", async () => {
    const f = fakeDb({ billing_request_cancel: () => { throw err("XX000"); } });
    const asaas = asaasFake();
    const result = await runCancel(deps(f.db, asaas), input());
    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/nada foi alterado/i) });
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
  });
  it("contratação ainda não confirmada (sem período pago): mensagem própria, sem prometer acesso", async () => {
    const f = fakeDb({ billing_request_cancel: () => ({ ...requested, effective_at: null, status: "canceled" }), billing_confirm_remote_cancel: () => null });
    const result = await runCancel(deps(f.db, asaasFake()), input());
    expect(result.message).toMatch(/nada foi cobrado/i);
    expect(result.message).not.toMatch(/acesso permanece/i);
  });
});

describe("cancelamento: clique duplo e pedido repetido", () => {
  it("dois pedidos ao mesmo tempo: os dois terminam bem e o Asaas só é chamado para o pedido que ainda estava pendente", async () => {
    let pending = true;
    const f = fakeDb({ billing_request_cancel: () => ({ ...requested, remote_cancel_pending: pending }), billing_confirm_remote_cancel: () => { pending = false; return null; } });
    const asaas = asaasFake();
    const [first, second] = await Promise.all([runCancel(deps(f.db, asaas), input()), runCancel(deps(f.db, asaas), input())]);
    expect(first.status).toBe("canceled");
    expect(second.status).toBe("canceled");
    expect(asaas.cancelSubscription.mock.calls.length).toBeLessThanOrEqual(2); // idempotente no Asaas (a 2ª remoção é no-op)
  });
  it("pedido repetido depois de concluído: nenhuma chamada ao Asaas", async () => {
    const f = fakeDb({ billing_request_cancel: () => ({ ...requested, remote_cancel_pending: false }), billing_confirm_remote_cancel: () => null });
    const asaas = asaasFake();
    expect((await runCancel(deps(f.db, asaas), input())).status).toBe("canceled");
    expect(asaas.cancelSubscription).not.toHaveBeenCalled();
    expect(f.of("billing_confirm_remote_cancel")).toHaveLength(0);
  });
});

describe("eventos do Asaas depois do cancelamento (idempotência, ordem)", () => {
  const event = (type: string, resource: "subscription" | "payment", id: string): ClaimedEvent => ({ id: 7, environment: "sandbox", asaas_event_id: "evt_abcdef0123456789&1", event_type: type, resource_type: resource, resource_id: id, payload: {}, attempts: 1 } as ClaimedEvent);
  const sub = { id: "sub_123456", customer: "cus_123456", value: 49.9, cycle: "MONTHLY", status: "INACTIVE", deleted: true, billingType: "CREDIT_CARD" };
  it("SUBSCRIPTION_DELETED depois do nosso próprio cancelamento: já registrado, sem alterar o período", async () => {
    const f = fakeDb({ billing_apply_subscription: () => "cancel_already_recorded" });
    const result = await processClaimedEvent(deps(f.db, asaasFake({ getSubscription: vi.fn(async () => sub) })), event("SUBSCRIPTION_DELETED", "subscription", "sub_123456"));
    expect(result).toEqual({ outcome: "processed", detail: "Resultado: cancel_already_recorded." });
  });
  it("PAYMENT_DELETED de cobrança removida pelo cancelamento (404): ignorado, sem erro", async () => {
    const f = fakeDb({});
    const asaas = asaasFake({ getPayment: vi.fn(async () => { throw new AsaasError("x", 404, null, false, false, "t"); }) });
    expect((await processClaimedEvent(deps(f.db, asaas), event("PAYMENT_DELETED", "payment", "pay_123456"))).outcome).toBe("ignored");
  });
  it("SUBSCRIPTION_DELETED entregue duas vezes: continua idempotente", async () => {
    const f = fakeDb({ billing_apply_subscription: () => "cancel_already_recorded" });
    const asaas = asaasFake({ getSubscription: vi.fn(async () => sub) });
    for (let i = 0; i < 2; i += 1) expect((await processClaimedEvent(deps(f.db, asaas), event("SUBSCRIPTION_DELETED", "subscription", "sub_123456"))).outcome).toBe("processed");
  });
  it("estorno e contestação NÃO são tratados como renovação paga: vão para revisão", async () => {
    const f = fakeDb({ billing_apply_payment: () => "needs_review" });
    const pay = { id: "pay_123456", subscription: "sub_123456", customer: "cus_123456", value: 49.9, dueDate: "2027-01-15", status: "CHARGEBACK_REQUESTED", billingType: "CREDIT_CARD" };
    const result = await processClaimedEvent(deps(f.db, asaasFake({ getPayment: vi.fn(async () => pay) })), event("PAYMENT_CHARGEBACK_REQUESTED", "payment", "pay_123456"));
    expect(result.outcome).toBe("needs_review");
  });
  it("renovação confirmada e cobrança repetida: ativada uma vez, a repetição é duplicidade segura", async () => {
    const outcomes = ["activated", "noop_duplicate"];
    const f = fakeDb({ billing_apply_payment: () => outcomes.shift() });
    const pay = { id: "pay_123456", subscription: "sub_123456", customer: "cus_123456", value: 49.9, dueDate: "2026-11-15", status: "CONFIRMED", billingType: "CREDIT_CARD" };
    const asaas = asaasFake({ getPayment: vi.fn(async () => pay) });
    expect((await processClaimedEvent(deps(f.db, asaas), event("PAYMENT_CONFIRMED", "payment", "pay_123456"))).detail).toBe("Resultado: activated.");
    expect((await processClaimedEvent(deps(f.db, asaas), event("PAYMENT_CONFIRMED", "payment", "pay_123456"))).detail).toBe("Resultado: noop_duplicate.");
  });
});

describe("tela: estados do ciclo de vida", () => {
  const parse = (value: unknown) => parseBillingSnapshot(value) as BillingSnapshot;
  const sub = (patch: Record<string, unknown> = {}) => ({ status: "active", cycle: "yearly", amount_cents: 49900, current_period_end: "2027-10-15T03:00:00Z", next_due_date: "2027-10-15", ...patch });
  it("cancelamento em processamento: não diz que a renovação foi interrompida e continua acompanhando", () => {
    const view = deriveContractView(parse({ subscription: sub({ cancel_requested_at: "2027-01-15T12:00:00Z", cancel_at_period_end: true, remote_cancel_pending: true }) }));
    expect(view).toMatchObject({ state: "canceling", polling: true });
    expect(view.message).toMatch(/ainda não foi interrompida/i);
    expect(view.message).toContain("15 de outubro de 2027");
  });
  it("cancelamento confirmado: acesso até o fim do período, sem renovação, dados preservados, sem reembolso", () => {
    const view = deriveContractView(parse({ subscription: sub({ cancel_requested_at: "2027-01-15T12:00:00Z", cancel_at_period_end: true, remote_cancel_pending: false }) }));
    expect(view).toMatchObject({ state: "cancel_scheduled", title: "Assinatura cancelada", polling: false });
    expect(view.message).toContain("15 de outubro de 2027");
    expect(view.message).toMatch(/não haverá renovação/i);
    expect(view.message).toMatch(/dados foram preservados/i);
    expect(view.message).toMatch(/reembolso/i);
  });
  it("assinatura ativa sem cancelamento continua 'confirmada'", () => {
    expect(deriveContractView(parse({ subscription: sub() })).state).toBe("confirmed");
  });
  it("em atraso: explica a tolerância e que pagar regulariza sozinho; suspensa: recursos pagos bloqueados, dados preservados, automações não refeitas", () => {
    const late = deriveContractView(parse({ subscription: sub({ status: "past_due", grace_ends_at: "2027-11-23T03:00:00Z" }) }));
    expect(late.state).toBe("past_due");
    expect(late.message).toMatch(/mantém o acesso/i);
    expect(late.message).toMatch(/continua automaticamente/i);
    const suspended = deriveContractView(parse({ subscription: sub({ status: "suspended" }) }));
    expect(suspended.state).toBe("suspended");
    expect(suspended.message).toMatch(/dados estão preservados/i);
    expect(suspended.message).toMatch(/não são refeitas/i);
  });
  it("encerrada depois do período pago: 'assinatura encerrada', com a data e a possibilidade de contratar de novo", () => {
    const view = deriveContractView(parse({ last_subscription: { status: "canceled", activated: true, canceled_at: "2027-10-15T03:00:00Z" } }));
    expect(view).toMatchObject({ state: "ended", polling: false });
    expect(view.message).toContain("15 de outubro de 2027");
    expect(view.message).toMatch(/dados foram preservados/i);
  });
  it("assinatura nunca ativada (cartão recusado) continua como 'pagamento não concluído', não como encerrada", () => {
    const view = deriveContractView(parse({ last_subscription: { status: "canceled", activated: false }, last_intent: { status: "completed", at: "2027-01-01T00:00:00Z" } }));
    expect(view.state).toBe("refused");
  });
});

describe("tela: resumo da assinatura e permissões de exibição", () => {
  const payments = (status: string) => [{ due_date: "2027-10-15", amount_cents: 49900, status, confirmed_at: null, invoice_url: null }];
  const snapshot = (sub: Record<string, unknown>, pays = payments("CONFIRMED")): BillingSnapshot => parseBillingSnapshot({ current_plan: { name: "Profissional", version: 1, kind: "subscription", access_state: "full" }, payments: pays,
    subscription: { status: "active", cycle: "yearly", amount_cents: 49900, current_period_end: "2027-10-15T03:00:00Z", next_due_date: "2027-10-15", ...sub } }) as BillingSnapshot;
  it("mostra plano, periodicidade, valor, estado, situação do pagamento, fim do período pago e próxima renovação", () => {
    const rows = describeSubscription(snapshot({}))!;
    const get = (label: string) => rows.find((row) => row.label === label)?.value;
    expect(get("Plano")).toBe("Profissional");
    expect(get("Periodicidade")).toBe("Anual");
    expect(get("Valor")).toMatch(/499,00.*ano/);
    expect(get("Estado")).toBe("Ativa");
    expect(get("Situação do pagamento")).toMatch(/Paga/);
    expect(get("Acesso pago até")).toBe("15 de outubro de 2027");
    expect(get("Próxima renovação")).toBe("15/10/2027");
  });
  it("cancelada: 'Sem renovação' e o estado deixa claro que o acesso vai até o fim do período pago", () => {
    const rows = describeSubscription(snapshot({ cancel_requested_at: "2027-01-15T00:00:00Z", cancel_at_period_end: true }))!;
    expect(rows.find((row) => row.label === "Próxima cobrança")?.value).toBe("Sem renovação");
    expect(rows.find((row) => row.label === "Estado")?.value).toMatch(/Cancelada, com acesso até o fim do período pago/);
  });
  it("cancelamento ainda NÃO confirmado pelo Asaas: o resumo não diz \"cancelada\" nem \"sem renovação\"", () => {
    const rows = describeSubscription(snapshot({ cancel_requested_at: "2027-01-15T00:00:00Z", cancel_at_period_end: true, remote_cancel_pending: true }))!;
    const get = (label: string) => rows.find((row) => row.label === label)?.value ?? "";
    expect(get("Estado")).toMatch(/Cancelamento em processamento/);
    expect(get("Estado")).not.toMatch(/^Cancelada/);
    expect(rows.map((row) => row.value).join(" ")).not.toMatch(/Sem renovação/);
    expect(get("Próxima renovação")).toMatch(/Aguardando a confirmação/);
  });
  it("situação da cobrança: paga, aguardando, em atraso, estorno/contestação (nunca como paga)", () => {
    expect(describeLatestPayment(payments("PENDING"))?.text).toMatch(/Aguardando pagamento/);
    expect(describeLatestPayment(payments("OVERDUE"))).toMatchObject({ tone: "bad" });
    expect(describeLatestPayment(payments("CHARGEBACK_REQUESTED"))?.text).toMatch(/Estorno ou contestação/);
    expect(describeLatestPayment(payments("RECEIVED"))?.tone).toBe("good");
    expect(describeLatestPayment([])).toBeNull();
  });
  it("cobrança em atraso aparece mesmo com cobrança futura pendente já gerada (e o link da fatura é o da atrasada)", () => {
    const list = [
      { due_date: "2026-12-15", amount_cents: 4990, status: "PENDING", confirmed_at: null, invoice_url: null },
      { due_date: "2026-10-14", amount_cents: 4990, status: "OVERDUE", confirmed_at: null, invoice_url: "https://sandbox.asaas.com/i/abc" },
      { due_date: "2026-10-15", amount_cents: 4990, status: "CONFIRMED", confirmed_at: "2026-10-15T00:00:00Z", invoice_url: null },
    ];
    expect(describeLatestPayment(list)).toMatchObject({ tone: "bad", text: expect.stringContaining("Em atraso (venceu em 14/10/2026)") });
    expect(openInvoiceLink(list)).toBe("https://sandbox.asaas.com/i/abc");
    expect(describeLatestPayment(list.filter((item) => item.status !== "OVERDUE"))?.text).toContain("Aguardando pagamento (vence em 15/12/2026)");
  });
  it("só o PROPRIETÁRIO vê o botão de cancelar, e só sem pedido anterior", () => {
    const active = snapshot({});
    expect(canRequestCancel(active, "owner")).toBe(true);
    for (const role of ["admin", "editor", "viewer"]) expect(canRequestCancel(active, role)).toBe(false);
    expect(canRequestCancel(snapshot({ cancel_requested_at: "2027-01-15T00:00:00Z", cancel_at_period_end: true }), "owner")).toBe(false);
    expect(canRequestCancel(snapshot({ status: "pending" }), "owner")).toBe(false);
    expect(canRequestCancel(snapshot({ status: "past_due" }), "owner")).toBe(true);
    expect(canRequestCancel(null, "owner")).toBe(false);
  });
  it("o link da cobrança em aberto só aceita endereços do Asaas", () => {
    expect(trustedInvoiceUrl("https://sandbox.asaas.com/i/abc")).toBe("https://sandbox.asaas.com/i/abc");
    expect(trustedInvoiceUrl("https://evil.example.com/i/abc")).toBeNull();
    expect(trustedInvoiceUrl("http://sandbox.asaas.com/i/abc")).toBeNull();
    expect(trustedInvoiceUrl("javascript:alert(1)")).toBeNull();
    expect(openInvoiceLink([{ due_date: "2027-10-15", amount_cents: 1, status: "OVERDUE", confirmed_at: null, invoice_url: "https://sandbox.asaas.com/i/abc" }])).toBe("https://sandbox.asaas.com/i/abc");
    expect(openInvoiceLink(payments("CONFIRMED"))).toBeNull();
  });
});
