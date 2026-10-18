import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, type AsaasApi } from "@/modules/billing/asaas-client";
import { billingDataSchema, isValidCnpj, isValidCpf, onlyDigits } from "@/modules/billing/billing-data";
import { buildReturnUrls, isTrustedCheckoutUrl, runCheckoutStart, type CheckoutContext } from "@/modules/billing/checkout-flow";
import type { BillingDb } from "@/modules/billing/db";
import type { BillingDeps } from "@/modules/billing/event-processor";
import { describeEntitlement, formatBRL, parseOffers, priceOf, yearlySavings } from "@/modules/billing/offers";
import { deriveContractView, parseBillingSnapshot, parseReturnHint, type BillingSnapshot } from "@/modules/billing/status-view";

const VERSION = "2bcccccc-0000-4000-8000-000000000001";
const OFFER = { plan_id: "p1", plan_version_id: VERSION, version: 1, name: "Profissional", description: "Para equipes", recommended: true, price_monthly_cents: 4990, price_yearly_cents: 49900,
  entitlements: [{ key: "clients", label: "Clientes ativos", kind: "limit", unit: "clientes", enabled: true, limit: 10, unlimited: false }, { key: "ai_assistant", label: "Inteligência artificial", kind: "feature", unit: null, enabled: true, limit: null, unlimited: false },
    { key: "whatsapp_numbers", label: "Números oficiais de WhatsApp", kind: "limit", unit: "números", enabled: true, limit: 0, unlimited: false }] };
const BILLING = { name: "Empresa Teste LTDA", cpfCnpj: "11.222.333/0001-81", email: "Cobranca@Example.test", phone: "(47) 3801-0919", postalCode: "89223-005", address: "Rua Teste", addressNumber: "277", province: "Centro" };

describe("dados de cobrança", () => {
  it("valida CPF e CNPJ pelos dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11.222.333/0001-80")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(onlyDigits("(47) 3801-0919")).toBe("4738010919");
  });
  it("normaliza os campos e recusa dados inválidos com mensagem clara", () => {
    expect(billingDataSchema.parse(BILLING)).toMatchObject({ cpfCnpj: "11222333000181", email: "cobranca@example.test", phone: "4738010919", postalCode: "89223005" });
    expect(billingDataSchema.parse(BILLING).complement).toBeUndefined();
    const cases: [Partial<typeof BILLING>, RegExp][] = [
      [{ cpfCnpj: "123" }, /CPF ou CNPJ válido/], [{ email: "sem-arroba" }, /e-mail válido/], [{ phone: "123" }, /telefone com DDD/], [{ postalCode: "123" }, /CEP/],
      [{ name: "ab" }, /nome ou a razão social/], [{ address: "" }, /endereço/], [{ addressNumber: "" }, /número/], [{ province: "" }, /bairro/], [{ addressNumber: "12; drop" }, /letras, números/],
    ];
    for (const [patch, message] of cases) {
      const result = billingDataSchema.safeParse({ ...BILLING, ...patch });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toMatch(message);
    }
  });
});

describe("ofertas e estados da tela", () => {
  it("só aceita ofertas bem formadas; preços e economia anual saem do banco", () => {
    expect(parseOffers([OFFER])).toHaveLength(1);
    expect(parseOffers([{ ...OFFER, plan_version_id: "nao-uuid" }])).toEqual([]);
    expect(parseOffers(null)).toEqual([]);
    const offer = parseOffers([OFFER])[0];
    expect(priceOf(offer, "monthly")).toBe(4990);
    expect(priceOf({ ...offer, price_yearly_cents: null }, "yearly")).toBeNull();
    expect(yearlySavings(offer)).toBe(4990 * 12 - 49900);
    expect(yearlySavings({ ...offer, price_yearly_cents: 4990 * 12 })).toBeNull();
    expect(formatBRL(49900).replace(/\s/g, " ")).toBe("R$ 499,00");
    expect(offer.entitlements.map(describeEntitlement)).toEqual(["Clientes ativos: até 10", "Inteligência artificial", null]);
  });
  const base: BillingSnapshot = { role: "owner", can_contract: true };
  it.each([
    ["sem nada ainda", base, null, "idle"],
    ["assinatura ativa", { ...base, subscription: { status: "active", cycle: "monthly", amount_cents: 4990, current_period_end: "2026-11-15T03:00:00Z" } }, null, "confirmed"],
    ["assinatura em atraso", { ...base, subscription: { status: "past_due", cycle: "monthly", amount_cents: 4990, grace_ends_at: "2026-10-23T03:00:00Z" } }, null, "past_due"],
    ["assinatura suspensa", { ...base, subscription: { status: "suspended", cycle: "monthly", amount_cents: 4990 } }, null, "suspended"],
    ["assinatura criada, pagamento não confirmado", { ...base, subscription: { status: "pending", cycle: "monthly", amount_cents: 4990 } }, null, "verifying_payment"],
    ["checkout aberto", { ...base, pending_checkout: { status: "awaiting_payment", cycle: "monthly", amount_cents: 4990, expires_at: "2026-10-15T15:00:00Z" } }, null, "awaiting_payment"],
    ["resultado desconhecido", { ...base, pending_checkout: { status: "unknown", cycle: "monthly", amount_cents: 4990, expires_at: "2026-10-15T15:00:00Z", retry_after: "2026-10-15T15:02:00Z" } }, null, "verifying_contract"],
    ["envio em andamento", { ...base, pending_checkout: { status: "dispatching", cycle: "monthly", amount_cents: 4990, expires_at: "2026-10-15T15:00:00Z" } }, null, "verifying_contract"],
    ["preparando", { ...base, pending_checkout: { status: "creating", cycle: "monthly", amount_cents: 4990, expires_at: "2026-10-15T15:00:00Z" } }, null, "preparing"],
    ["checkout expirado", { ...base, last_intent: { status: "expired" } }, null, "expired"],
    ["checkout cancelado", { ...base, last_intent: { status: "canceled" } }, null, "canceled"],
    ["falha ao preparar", { ...base, last_intent: { status: "failed" } }, null, "temporary_error"],
    ["pagamento recusado (assinatura nunca ativada e encerrada)", { ...base, last_intent: { status: "completed" }, last_subscription: { status: "canceled", activated: false } }, null, "refused"],
  ] as const)("%s → %s", (_name, billing, hint, state) => {
    expect(deriveContractView(billing as BillingSnapshot, hint).state).toBe(state);
  });
  it("a página de sucesso do checkout NUNCA confirma: só verifica (dica 'ok' sem assinatura ativa)", () => {
    const awaiting = { ...base, pending_checkout: { status: "awaiting_payment", cycle: "monthly", amount_cents: 4990, expires_at: "2026-10-15T15:00:00Z" } };
    // Relógio FIXO (antes do prazo do checkout): o teste não pode depender do dia em que roda.
    expect(deriveContractView(awaiting, "ok", new Date("2026-10-15T14:40:00Z"))).toMatchObject({ state: "verifying_payment", polling: true });
    expect(deriveContractView(base, "ok")).toMatchObject({ state: "verifying_payment", polling: true });
    for (const hint of ["ok", "cancelado", "expirado"] as const) expect(deriveContractView(base, hint).state).not.toBe("confirmed");
    expect(deriveContractView({ ...base, last_intent: { status: "failed" } }, "ok").state).toBe("verifying_payment");
  });
  it("dica de URL adulterada não vira estado; só 'ok', 'cancelado' e 'expirado' são aceitas", () => {
    expect(parseReturnHint("ok")).toBe("ok");
    expect(parseReturnHint("confirmado")).toBeNull();
    expect(parseReturnHint(["ok"])).toBeNull();
    expect(parseReturnHint(undefined)).toBeNull();
    expect(deriveContractView(base, parseReturnHint("active")).state).toBe("idle");
  });
  it("sem leitura do banco a tela diz 'indisponível' e nunca 'confirmado'", () => {
    expect(deriveContractView(null).state).toBe("unavailable");
    expect(parseBillingSnapshot({ subscription: { status: 5 } })).toBeNull();
  });
  it("cancelamento programado é explicado", () => {
    expect(deriveContractView({ ...base, subscription: { status: "active", cycle: "monthly", amount_cents: 4990, current_period_end: "2026-11-15T03:00:00Z", cancel_at_period_end: true } })).toMatchObject({ state: "cancel_scheduled", message: expect.stringMatching(/não haverá renovação/i) });
  });
});

type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: BillingDb = {
    async rpc(name, args = {}) {
      calls.push({ name, args });
      try { return { data: handlers[name]?.(args) ?? null, error: null }; } catch (error) { return { data: null, error: { code: (error as { code?: string }).code ?? "XX000", message: (error as Error).message } }; }
    },
  };
  return { db, calls, of: (name: string) => calls.filter((call) => call.name === name) };
}
const intent = (patch: Record<string, unknown> = {}) => ({ intent_id: "int-1", status: "creating", reused: false, asaas_checkout_id: null, checkout_url: null, amount_cents: 4990, checkout_minutes: 30, expires_at: "2026-10-15T15:32:00Z", ...patch });
type FakeAsaas = { [K in keyof AsaasApi]: ReturnType<typeof vi.fn> };
function asaasFake(overrides: Partial<Record<keyof AsaasApi, unknown>> = {}): FakeAsaas {
  return { createCustomer: vi.fn(async () => ({ id: "cus_123456" })), createCheckout: vi.fn(async () => ({ id: "chk_123456", link: "https://sandbox.asaas.com/checkoutSession/show?id=chk_123456" })),
    cancelSubscription: vi.fn(), getPayment: vi.fn(), getSubscription: vi.fn(), listSubscriptionPayments: vi.fn(), listCustomerSubscriptions: vi.fn(), ...overrides } as unknown as FakeAsaas;
}
const deps = (db: BillingDb, asaas: FakeAsaas): BillingDeps => ({ db, asaas: asaas as unknown as AsaasApi, environment: "sandbox", now: () => new Date("2026-10-15T15:00:00Z") });
const context = (patch: Partial<CheckoutContext> = {}): CheckoutContext => ({ agencyId: "agency-A", userId: "user-1", role: "owner", origin: "https://teste.example.com", listOffers: async () => [OFFER], ...patch });
const input = (patch: Record<string, unknown> = {}) => ({ planVersionId: VERSION, cycle: "monthly", requestKey: "chave-0001-aaaa", billing: BILLING, ...patch });
const standard = (extra: Record<string, Handler> = {}) => fakeDb({ billing_get_customer: () => null, billing_create_intent: () => intent(), billing_set_customer: () => "cus_123456", billing_mark_intent: () => ({ expires_at: "2026-10-15T15:32:00Z" }), ...extra });

describe("início da contratação (servidor)", () => {
  it("proprietário com dados válidos: cria cliente e checkout UMA vez e devolve o endereço do Asaas", async () => {
    const f = standard();
    const asaas = asaasFake();
    const result = await runCheckoutStart(deps(f.db, asaas), context(), input());
    expect(result).toEqual({ status: "redirect", url: "https://sandbox.asaas.com/checkoutSession/show?id=chk_123456", reused: false });
    expect(asaas.createCustomer.mock.calls[0][0]).toMatchObject({ name: "Empresa Teste LTDA", cpfCnpj: "11222333000181", email: "cobranca@example.test", phone: "4738010919", postalCode: "89223005", externalReference: "agency-A" });
    expect(asaas.createCheckout).toHaveBeenCalledTimes(1);
    expect(asaas.createCheckout.mock.calls[0][0]).toMatchObject({ valueCents: 4990, cycle: "monthly", successUrl: "https://teste.example.com/assinatura/retorno?e=ok", cancelUrl: "https://teste.example.com/assinatura/retorno?e=cancelado", expiredUrl: "https://teste.example.com/assinatura/retorno?e=expirado" });
  });
  it("o valor cobrado é o do BANCO: preço, valor ou plano enviados pelo navegador são ignorados", async () => {
    const f = standard({ billing_create_intent: () => intent({ amount_cents: 4990 }) });
    const asaas = asaasFake();
    await runCheckoutStart(deps(f.db, asaas), context(), input({ price: 1, priceCents: 1, valueCents: 1, amount: 1, amount_cents: 1, planName: "Grátis", cycle: "monthly" }));
    expect(asaas.createCheckout.mock.calls[0][0].valueCents).toBe(4990);
    expect(JSON.stringify(f.of("billing_create_intent")[0].args)).not.toMatch(/priceCents|"price"|valueCents|"amount/);
    expect(asaas.createCheckout.mock.calls[0][0].itemName).toBe("Profissional");
  });
  it("anual cobra o valor integral da anuidade, sem parcelamento", async () => {
    const f = standard({ billing_create_intent: () => intent({ amount_cents: 49900 }) });
    const asaas = asaasFake();
    await runCheckoutStart(deps(f.db, asaas), context(), input({ cycle: "yearly" }));
    expect(f.of("billing_create_intent")[0].args.p_cycle).toBe("yearly");
    expect(asaas.createCheckout.mock.calls[0][0]).toMatchObject({ cycle: "yearly", valueCents: 49900 });
    expect(JSON.stringify(asaas.createCheckout.mock.calls[0][0])).not.toMatch(/installment|parcel/i);
  });
  it.each(["admin", "editor", "viewer"])("%s NÃO contrata: recusado antes de qualquer consulta ou chamada externa", async (role) => {
    const f = standard();
    const asaas = asaasFake();
    expect(await runCheckoutStart(deps(f.db, asaas), context({ role }), input())).toEqual({ status: "error", message: "Somente o proprietário da organização pode contratar." });
    expect(f.calls).toHaveLength(0);
    expect(asaas.createCustomer).not.toHaveBeenCalled();
    expect(asaas.createCheckout).not.toHaveBeenCalled();
  });
  it("entradas inválidas são recusadas sem tocar no banco nem no Asaas", async () => {
    for (const bad of [null, "texto", {}, input({ planVersionId: "nao-uuid" }), input({ cycle: "quinzenal" }), input({ requestKey: "curta" }), input({ requestKey: "chave com espaço!" })]) {
      const f = standard();
      const result = await runCheckoutStart(deps(f.db, asaasFake()), context(), bad);
      expect(result.status).toBe("error");
      expect(f.calls).toHaveLength(0);
    }
  });
  it("plano fora da lista de ofertas (ou sem preço no ciclo) não pode ser contratado, mesmo com um id válido", async () => {
    const f = standard();
    expect((await runCheckoutStart(deps(f.db, asaasFake()), context(), input({ planVersionId: "7a7a7a7a-0000-4000-8000-000000000001" }))).status).toBe("error");
    expect((await runCheckoutStart(deps(f.db, asaasFake()), context({ listOffers: async () => [{ ...OFFER, price_yearly_cents: null }] }), input({ cycle: "yearly" }))).status).toBe("error");
    expect((await runCheckoutStart(deps(f.db, asaasFake()), context({ listOffers: async () => { throw new Error("fora"); } }), input())).status).toBe("error");
    expect(f.of("billing_create_intent")).toHaveLength(0);
  });
  it("sem cliente financeiro e sem dados de cobrança: pede os dados e não cria intenção", async () => {
    const f = standard();
    const result = await runCheckoutStart(deps(f.db, asaasFake()), context(), input({ billing: undefined }));
    expect(result.status).toBe("needs_billing_data");
    expect(f.of("billing_create_intent")).toHaveLength(0);
  });
  it("dados de cobrança inválidos: aponta o campo e não cria intenção nem cliente", async () => {
    const f = standard();
    const asaas = asaasFake();
    const result = await runCheckoutStart(deps(f.db, asaas), context(), input({ billing: { ...BILLING, cpfCnpj: "111.111.111-11" } }));
    expect(result).toMatchObject({ status: "invalid_data", field: "cpfCnpj" });
    expect(f.of("billing_create_intent")).toHaveLength(0);
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it("organização que já tem cliente financeiro não pede nem reenvia dados pessoais", async () => {
    const f = standard({ billing_get_customer: () => "cus_123456" });
    const asaas = asaasFake();
    const result = await runCheckoutStart(deps(f.db, asaas), context(), input({ billing: { lixo: true } }));
    expect(result.status).toBe("redirect");
    expect(asaas.createCustomer).not.toHaveBeenCalled();
  });
  it("só segue para o checkout hospedado do Sandbox: endereço de outro lugar é recusado e nunca devolvido", async () => {
    for (const link of ["https://evil.example.com/pagar", "http://sandbox.asaas.com/checkoutSession/show?id=1", "https://sandbox.asaas.com.evil.com/x", "https://user:senha@sandbox.asaas.com/x", "javascript:alert(1)", "//sandbox.asaas.com/x", "https://www.asaas.com/checkoutSession/show?id=1", ""]) {
      const result = await runCheckoutStart(deps(standard().db, asaasFake({ createCheckout: vi.fn(async () => ({ id: "chk_123456", link })) })), context(), input());
      expect(result.status).not.toBe("redirect"); // endereço fora do Sandbox do Asaas nunca vira redirecionamento (sem endereço, apenas aguarda)
      expect(JSON.stringify(result)).not.toMatch(/evil|javascript|senha/);
    }
    expect(isTrustedCheckoutUrl("https://sandbox.asaas.com/checkoutSession/show?id=abc")).toBe(true);
    expect(isTrustedCheckoutUrl(null)).toBe(false);
  });
  it("clique duplo / duas abas: o segundo pedido reaproveita a intenção e NÃO cria outro checkout", async () => {
    let calls = 0;
    const f = standard({ billing_create_intent: () => (++calls === 1 ? intent() : intent({ reused: true, status: "creating" })) });
    const asaas = asaasFake();
    const [first, second] = await Promise.all([runCheckoutStart(deps(f.db, asaas), context(), input()), runCheckoutStart(deps(f.db, asaas), context(), input())]);
    expect([first.status, second.status].sort()).toEqual(["pending", "redirect"]);
    expect(asaas.createCheckout).toHaveBeenCalledTimes(1);
  });
  it("checkout já aberto: devolve o mesmo endereço, sem criar de novo", async () => {
    const f = standard({ billing_create_intent: () => intent({ reused: true, status: "awaiting_payment", checkout_url: "https://sandbox.asaas.com/checkoutSession/show?id=chk_000111" }) });
    const asaas = asaasFake();
    expect(await runCheckoutStart(deps(f.db, asaas), context(), input())).toEqual({ status: "redirect", url: "https://sandbox.asaas.com/checkoutSession/show?id=chk_000111", reused: true });
    expect(asaas.createCheckout).not.toHaveBeenCalled();
  });
  it("timeout ao criar o checkout: 'verificando', sem cobrança e sem repetir a criação", async () => {
    const f = standard();
    const asaas = asaasFake({ createCheckout: vi.fn(async () => { throw new AsaasError("x", null, "network", true, true, "t"); }) });
    const result = await runCheckoutStart(deps(f.db, asaas), context(), input());
    expect(result).toMatchObject({ status: "pending", retryAfter: "2026-10-15T15:32:00Z" });
    expect((result as { message: string }).message).toMatch(/verificando sua contratação.*Não há nova cobrança/);
    expect(asaas.createCheckout).toHaveBeenCalledTimes(1);
    expect(f.of("billing_mark_intent").map((call) => call.args.p_status)).toEqual(["dispatching", "unknown"]);
  });
  it("organização com assinatura ou sem permissão no banco recebe a mensagem certa", async () => {
    const forbidden = standard({ billing_create_intent: () => { throw Object.assign(new Error("x"), { code: "42501" }); } });
    expect((await runCheckoutStart(deps(forbidden.db, asaasFake()), context(), input()))).toEqual({ status: "error", message: "Somente o proprietário da organização pode contratar." });
    const already = standard({ billing_create_intent: () => { throw Object.assign(new Error("x"), { code: "23505" }); } });
    expect(((await runCheckoutStart(deps(already.db, asaasFake()), context(), input())) as { message: string }).message).toMatch(/já possui uma assinatura/);
  });
  it("sem endereço público configurado para o retorno, a contratação não inicia", async () => {
    for (const origin of [null, undefined, "", "nao-é-url", "ftp://exemplo.com"]) {
      const f = standard();
      expect((await runCheckoutStart(deps(f.db, asaasFake()), context({ origin }), input())).status).toBe("error");
      expect(f.calls).toHaveLength(0);
    }
  });
  it("URLs de retorno usam só a origem configurada e caminhos fixos", () => {
    expect(buildReturnUrls("https://app.exemplo.com/qualquer/coisa?x=1")).toEqual({
      successUrl: "https://app.exemplo.com/assinatura/retorno?e=ok", cancelUrl: "https://app.exemplo.com/assinatura/retorno?e=cancelado", expiredUrl: "https://app.exemplo.com/assinatura/retorno?e=expirado",
    });
  });
  it("nenhum dado pessoal vai para os registros de falha", async () => {
    const f = standard();
    const asaas = asaasFake({ createCustomer: vi.fn(async () => { throw new AsaasError("Cliente Empresa Teste LTDA 11222333000181", 400, "invalid_object", false, false, "t"); }) });
    await runCheckoutStart(deps(f.db, asaas), context(), input());
    expect(JSON.stringify(f.calls)).not.toMatch(/11222333000181|Empresa Teste|cobranca@example/);
  });
});
