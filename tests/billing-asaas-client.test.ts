import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, createAsaasClient } from "@/modules/billing/asaas-client";
import type { AsaasConfig } from "@/modules/billing/config";

const config: AsaasConfig = { baseUrl: "https://api-sandbox.asaas.com/v3", apiKey: "$aact_hmlg_TESTE-SEGREDO-0000000000000000", environment: "sandbox" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const payment = { id: "pay_123456", subscription: "sub_123456", customer: "cus_123456", value: 49.9, dueDate: "2026-10-15", status: "CONFIRMED", billingType: "CREDIT_CARD", invoiceUrl: "https://example.test/i", extra: "ignorado" };

function client(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init); }) as unknown as typeof fetch;
  return { api: createAsaasClient(config, { fetchImpl, timeoutMs: 50 }), calls };
}

describe("cliente do Asaas (Sandbox, simulado)", () => {
  it("só fala com a URL do Sandbox, envia a chave só no cabeçalho e valida a resposta", async () => {
    const { api, calls } = client(() => json(payment));
    const result = await api.getPayment("pay_123456");
    expect(result).toMatchObject({ id: "pay_123456", status: "CONFIRMED", value: 49.9 });
    expect(result).not.toHaveProperty("extra");
    expect(calls[0].url).toBe("https://api-sandbox.asaas.com/v3/payments/pay_123456");
    expect((calls[0].init.headers as Record<string, string>).access_token).toBe(config.apiKey);
    expect(calls[0].url).not.toContain(config.apiKey);
    expect(String(calls[0].init.body ?? "")).not.toContain(config.apiKey);
  });
  it("recusa identificadores com caracteres perigosos (sem chamar a rede)", async () => {
    const { api, calls } = client(() => json(payment));
    await expect(api.getPayment("../customers")).rejects.toBeInstanceOf(AsaasError);
    await expect(api.getSubscription("sub_1/../../x")).rejects.toBeInstanceOf(AsaasError);
    expect(calls).toHaveLength(0);
  });
  it("cadastro do cliente envia os dados de cobrança exigidos pelo checkout e desliga notificações", async () => {
    const { api, calls } = client(() => json({ id: "cus_123456" }));
    await api.createCustomer({ name: "Org", cpfCnpj: "24971563792", email: "a@b.test", phone: "4738010919", postalCode: "89223005", address: "Rua Teste", addressNumber: "277", province: "Centro", complement: "Sala 2", externalReference: "agency-1" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ phone: "4738010919", postalCode: "89223005", address: "Rua Teste", addressNumber: "277", province: "Centro", complement: "Sala 2", notificationDisabled: true, externalReference: "agency-1" });
    expect(calls[0].url).toBe("https://api-sandbox.asaas.com/v3/customers");
  });
  it("checkout: só cartão, recorrente, valor do servidor, sem parcelamento e sem dados de cartão", async () => {
    const { api, calls } = client(() => json({ id: "chk_123456", link: "https://sandbox.asaas.com/checkoutSession/show?id=chk_123456" }));
    const created = await api.createCheckout({ customerId: "cus_123456", itemName: "Plano", valueCents: 49900, cycle: "yearly", nextDueDate: "2026-10-15", minutesToExpire: 60, successUrl: "https://app.test/ok", cancelUrl: "https://app.test/no", expiredUrl: "https://app.test/exp" });
    expect(created).toEqual({ id: "chk_123456", link: "https://sandbox.asaas.com/checkoutSession/show?id=chk_123456" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], customer: "cus_123456", minutesToExpire: 60, subscription: { cycle: "YEARLY" } });
    expect(body.items[0]).toMatchObject({ quantity: 1, value: 499 });
    expect(JSON.stringify(body)).not.toMatch(/installment|PIX|BOLETO|creditCard|cvv|ccv/i);
    expect(body).not.toHaveProperty("externalReference"); // só enviado quando informado
    expect(calls[0].init.method).toBe("POST");
  });
  it("checkout: nome do item limitado a 30 caracteres e identificador interno enviado como externalReference", async () => {
    const { api, calls } = client(() => json({ id: "chk_123456", link: "https://s.test/c" }));
    await api.createCheckout({ customerId: "cus_123456", itemName: "Plano Profissional Agência Completa Anual", valueCents: 4990, cycle: "monthly", nextDueDate: "2026-10-15", minutesToExpire: 30, successUrl: "https://a.test/1", cancelUrl: "https://a.test/2", expiredUrl: "https://a.test/3", externalReference: "int-1234" });
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.items[0].name).toHaveLength(30);
    expect(body.externalReference).toBe("int-1234");
    expect(body.minutesToExpire).toBe(30);
    expect(body.items[0]).not.toHaveProperty("imageBase64");
  });
  it("lista as assinaturas de um cliente (inclui removidas) com limite máximo de 100", async () => {
    const { api, calls } = client(() => json({ data: [{ id: "sub_123456", customer: "cus_123456", value: 49.9, cycle: "MONTHLY", status: "ACTIVE", billingType: "CREDIT_CARD" }], hasMore: false }));
    expect(await api.listCustomerSubscriptions("cus_123456", 900)).toHaveLength(1);
    expect(calls[0].url).toBe("https://api-sandbox.asaas.com/v3/subscriptions?customer=cus_123456&includeDeleted=true&limit=100");
    await expect(api.listCustomerSubscriptions("cus_1&x=1")).rejects.toBeInstanceOf(AsaasError);
  });
  it("ciclo mensal usa MONTHLY", async () => {
    const { api, calls } = client(() => json({ id: "chk_123456" }));
    const created = await api.createCheckout({ customerId: "cus_123456", itemName: "Plano", valueCents: 4990, cycle: "monthly", nextDueDate: "2026-10-15", minutesToExpire: 60, successUrl: "https://a.test/1", cancelUrl: "https://a.test/2", expiredUrl: "https://a.test/3" });
    expect(created.link).toBeNull();
    expect(JSON.parse(String(calls[0].init.body)).subscription.cycle).toBe("MONTHLY");
  });
  it("escrita sem resposta (timeout) é AMBÍGUA: pode ter sido concluída no Asaas", async () => {
    const { api } = client((_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("abortado")))));
    const error = await api.createCustomer({ name: "X", cpfCnpj: "00000000000", email: "a@b.test", phone: "4738010919", postalCode: "89223005", address: "Rua Teste", addressNumber: "277", province: "Centro", externalReference: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(AsaasError);
    expect(error).toMatchObject({ ambiguous: true, retryable: true, status: null });
  });
  it("leitura sem resposta não é ambígua", async () => {
    const { api } = client(() => { throw new Error("rede"); });
    expect(await api.getPayment("pay_123456").catch((e) => e)).toMatchObject({ ambiguous: false, retryable: true });
  });
  it("erro 4xx é definitivo; 5xx em escrita é ambíguo; 429 é repetível", async () => {
    const four = await client(() => json({ errors: [{ code: "invalid_action", description: "x" }] }, 400)).api.cancelSubscription("sub_123456").catch((e) => e);
    expect(four).toMatchObject({ status: 400, code: "invalid_action", ambiguous: false, retryable: false });
    const five = await client(() => json({}, 503)).api.createCustomer({ name: "X", cpfCnpj: "0", email: "a@b.test", phone: "4738010919", postalCode: "89223005", address: "Rua Teste", addressNumber: "277", province: "Centro", externalReference: "x" }).catch((e) => e);
    expect(five).toMatchObject({ status: 503, ambiguous: true, retryable: true });
    const limited = await client(() => json({}, 429)).api.getPayment("pay_123456").catch((e) => e);
    expect(limited).toMatchObject({ status: 429, ambiguous: false, retryable: true });
  });
  it("resposta em formato inesperado é rejeitada, sem vazar a chave", async () => {
    const error = await client(() => json({ id: 123 })).api.getPayment("pay_123456").catch((e) => e);
    expect(error).toMatchObject({ code: "invalid_response" });
    expect(String(error.message)).not.toContain(config.apiKey);
  });
  it("lista de cobranças da assinatura e cancelamento", async () => {
    const { api, calls } = client((url, init) => init.method === "DELETE" ? json({ deleted: true, id: "sub_123456" }) : json({ data: [payment], hasMore: false }));
    expect(await api.listSubscriptionPayments("sub_123456", 500)).toHaveLength(1);
    expect(calls[0].url).toContain("/subscriptions/sub_123456/payments?limit=50");
    await expect(api.cancelSubscription("sub_123456")).resolves.toBeUndefined();
    expect(calls[1].init.method).toBe("DELETE");
  });
});
