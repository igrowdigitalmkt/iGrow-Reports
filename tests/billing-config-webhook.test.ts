import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ASAAS_SANDBOX_BASE_URL, asaasConfigProblem, getAsaasConfig, getAsaasWebhookToken, ASAAS_PRODUCTION_BASE_URL, configuredBillingEnvironment } from "@/modules/billing/config";
import { MAX_WEBHOOK_BYTES, parseAsaasEvent, validateWebhookToken } from "@/modules/billing/webhook";

const KEY = "$aact_hmlg_000000000000000000000000000000000000";
const TOKEN = "a".repeat(40);

describe("configuração do Asaas: Sandbox por padrão, produção só com travas", () => {
  it("aceita ambiente sandbox com chave de teste e fixa a URL do Sandbox", () => {
    const config = getAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: KEY });
    expect(config).toEqual({ baseUrl: ASAAS_SANDBOX_BASE_URL, apiKey: KEY, environment: "sandbox" });
    expect(ASAAS_SANDBOX_BASE_URL).toBe("https://api-sandbox.asaas.com/v3");
  });
  it("ambiente ausente ou desconhecido deixa a integração inerte", () => {
    expect(asaasConfigProblem({ ASAAS_API_KEY: KEY })).toBe("environment_invalid");
    expect(asaasConfigProblem({ ASAAS_ENVIRONMENT: "staging", ASAAS_API_KEY: KEY })).toBe("environment_invalid");
    expect(configuredBillingEnvironment({})).toBe("sandbox");
    expect(configuredBillingEnvironment({ ASAAS_ENVIRONMENT: "Production" })).toBe("sandbox");
  });
  it("PRODUÇÃO só abre com ambiente, desbloqueio explícito e chave de produção juntos; chave de sandbox em produção é recusada", () => {
    const prod = "$aact_prod_00000000000000000000000000000000";
    expect(asaasConfigProblem({ ASAAS_ENVIRONMENT: "production", ASAAS_API_KEY: KEY })).toBe("sandbox_key");
    expect(asaasConfigProblem({ ASAAS_ENVIRONMENT: "production", ASAAS_API_KEY: prod })).toBe("production_not_unlocked");
    expect(asaasConfigProblem({ ASAAS_ENVIRONMENT: "production", ASAAS_API_KEY: prod, ASAAS_PRODUCTION_UNLOCK: "true" })).toBe("production_not_unlocked");
    expect(getAsaasConfig({ ASAAS_ENVIRONMENT: "production", ASAAS_API_KEY: prod })).toBeNull();
    expect(getAsaasConfig({ ASAAS_ENVIRONMENT: "production", ASAAS_API_KEY: prod, ASAAS_PRODUCTION_UNLOCK: "yes" })).toEqual({ baseUrl: ASAAS_PRODUCTION_BASE_URL, apiKey: prod, environment: "production" });
    expect(ASAAS_PRODUCTION_BASE_URL).toBe("https://api.asaas.com/v3");
    expect(configuredBillingEnvironment({ ASAAS_ENVIRONMENT: "production" })).toBe("production");
    // O desbloqueio não afeta o sandbox, que continua usando só a URL de testes.
    expect(getAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: KEY, ASAAS_PRODUCTION_UNLOCK: "yes" })?.baseUrl).toBe(ASAAS_SANDBOX_BASE_URL);
  });
  it("chave de produção é recusada mesmo com ambiente sandbox", () => {
    expect(getAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: "$aact_prod_00000000000000000000000000000000" })).toBeNull();
    expect(asaasConfigProblem({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: "$aact_prod_00000000000000000000000000000000" })).toBe("production_key");
  });
  it("chave ausente ou malformada deixa a integração inerte", () => {
    expect(asaasConfigProblem({ ASAAS_ENVIRONMENT: "sandbox" })).toBe("missing_key");
    expect(asaasConfigProblem({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: "curta" })).toBe("invalid_key");
    expect(getAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: "tem espaço " + "x".repeat(30) })).toBeNull();
  });
  it("token do webhook precisa ter 32+ caracteres seguros e nunca ser a chave de API", () => {
    expect(getAsaasWebhookToken({ ASAAS_WEBHOOK_TOKEN: TOKEN })).toBe(TOKEN);
    expect(getAsaasWebhookToken({ ASAAS_WEBHOOK_TOKEN: "curto" })).toBeNull();
    expect(getAsaasWebhookToken({ ASAAS_WEBHOOK_TOKEN: "x y".repeat(20) })).toBeNull();
    expect(getAsaasWebhookToken({})).toBeNull();
    const same = "k".repeat(40);
    expect(getAsaasWebhookToken({ ASAAS_WEBHOOK_TOKEN: same, ASAAS_API_KEY: same })).toBeNull();
  });
});

describe("autenticação do webhook por token", () => {
  it("aceita o token correto", () => expect(validateWebhookToken(TOKEN, TOKEN)).toBe("ok"));
  it("recusa token ausente, errado ou de outro tamanho", () => {
    expect(validateWebhookToken(null, TOKEN)).toBe("invalid");
    expect(validateWebhookToken("", TOKEN)).toBe("invalid");
    expect(validateWebhookToken("b".repeat(40), TOKEN)).toBe("invalid");
    expect(validateWebhookToken(TOKEN + "x", TOKEN)).toBe("invalid");
    expect(validateWebhookToken("x".repeat(500), TOKEN)).toBe("invalid");
  });
  it("sem token configurado nada é aceito", () => expect(validateWebhookToken(TOKEN, null)).toBe("unconfigured"));
  it("limita o tamanho do corpo", () => expect(MAX_WEBHOOK_BYTES).toBeLessThanOrEqual(128 * 1024));
});

describe("leitura do evento", () => {
  const payment = { id: "evt_0123456789", event: "PAYMENT_CONFIRMED", dateCreated: "2026-10-15 10:00:00", payment: { id: "pay_123456", subscription: "sub_123456", status: "CONFIRMED", value: 49.9, dueDate: "2026-10-15", customer: "cus_123456", description: "dado extra", creditCard: { creditCardNumber: "4444" }, customerName: "Fulano" } };
  it("extrai identificador, tipo e recurso, e descarta tudo que não é necessário (inclusive dados pessoais)", () => {
    const parsed = parseAsaasEvent(payment)!;
    expect(parsed).toMatchObject({ eventId: "evt_0123456789", eventType: "PAYMENT_CONFIRMED", resourceType: "payment", resourceId: "pay_123456" });
    const stored = JSON.stringify(parsed.payload);
    expect(stored).not.toMatch(/Fulano|4444|creditCard|customerName|description|cus_123456/);
  });
  it("reconhece eventos de assinatura e de checkout", () => {
    expect(parseAsaasEvent({ id: "evt_aaaaaaaa", event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_123456" } })).toMatchObject({ resourceType: "subscription", resourceId: "sub_123456" });
    expect(parseAsaasEvent({ id: "evt_bbbbbbbb", event: "CHECKOUT_PAID", checkout: { id: "chk_123456" } })).toMatchObject({ resourceType: "checkout", resourceId: "chk_123456" });
  });
  it("evento de tipo desconhecido é aceito como 'other' (campos novos não quebram a fila)", () => {
    expect(parseAsaasEvent({ id: "evt_cccccccc", event: "ALGO_NOVO", novo: { x: 1 } })).toMatchObject({ resourceType: "other", resourceId: null });
  });
  it("aceita o identificador de evento real do Asaas, com '&' (documentação: evt_<hex>&<número>)", () => {
    const real = "evt_05b708f961d739ea7eba7e4db318f621&368604920";
    expect(parseAsaasEvent({ id: real, event: "PAYMENT_RECEIVED", dateCreated: "2024-06-12 16:45:03", payment: { object: "payment", id: "pay_080225913252" } })).toMatchObject({ eventId: real, resourceType: "payment", resourceId: "pay_080225913252" });
    expect(parseAsaasEvent({ id: real, event: "CHECKOUT_PAID", checkout: { object: "checkout", id: "745c3be9-9a29-42cd-946a-cd8a5a586466" } })).toMatchObject({ eventId: real, resourceType: "checkout" });
  });
  it("o '&' só vale no identificador do evento: recursos e caracteres perigosos continuam recusados", () => {
    expect(parseAsaasEvent({ id: "evt_aaaaaaaa", event: "PAYMENT_CONFIRMED", payment: { id: "pay_1&2345" } })).toBeNull();
    expect(parseAsaasEvent({ id: "evt_aaaa aaaa&1", event: "PAYMENT_CONFIRMED" })).toBeNull();
    expect(parseAsaasEvent({ id: "evt_a;drop&1", event: "PAYMENT_CONFIRMED" })).toBeNull();
    expect(parseAsaasEvent({ id: `evt_${"a".repeat(130)}&1`, event: "PAYMENT_CONFIRMED" })).toBeNull();
  });
  it("recusa conteúdo inválido", () => {
    expect(parseAsaasEvent(null)).toBeNull();
    expect(parseAsaasEvent({})).toBeNull();
    expect(parseAsaasEvent({ id: "x", event: "PAYMENT_CONFIRMED" })).toBeNull();
    expect(parseAsaasEvent({ id: "evt_dddddddd", event: "payment_confirmed" })).toBeNull();
    expect(parseAsaasEvent({ id: "evt_dddddddd", event: "PAYMENT_CONFIRMED", payment: { id: "../etc" } })).toBeNull();
  });
});
