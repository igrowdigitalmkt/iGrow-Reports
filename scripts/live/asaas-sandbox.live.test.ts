/**
 * TESTE REAL (não faz parte do produto nem do `pnpm test`): valida os contratos do cliente do Asaas contra o SANDBOX
 * (https://api-sandbox.asaas.com/v3). Dados 100% fictícios; nenhum dinheiro real; a chave nunca é impressa.
 * Só roda com ASAAS_ENVIRONMENT=sandbox e uma chave do Sandbox em .env.asaas-sandbox. Sem chave, tudo é ignorado.
 * Para as assinaturas de teste usa o cartão de TESTE publicado pela documentação do Asaas (não é cartão real) apenas neste
 * arquivo; o aplicativo nunca manipula dados de cartão (o cartão real vai só no checkout hospedado).
 * Uso: pnpm test:asaas-live
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, createAsaasClient, type AsaasPayment, type AsaasSubscription } from "@/modules/billing/asaas-client";
import { ASAAS_SANDBOX_BASE_URL, asaasConfigProblem, getAsaasConfig } from "@/modules/billing/config";
import { applyPayment, applySubscription, type BillingDeps } from "@/modules/billing/event-processor";
import { asBillingDb } from "@/modules/billing/db";

type Admin = {
  from(table: string): { insert(values: unknown): PromiseLike<{ error: unknown }> & { select(columns: string): { single(): PromiseLike<{ data: { id: string } | null; error: unknown }> } } };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

const config = getAsaasConfig();
const problem = asaasConfigProblem();
const stamp = Date.now().toString(36);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const live = config ? describe : describe.skip;

function cpf() {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 9));
  const digit = (numbers: number[]) => { const sum = numbers.reduce((total, value, index) => total + value * (numbers.length + 1 - index), 0); const rest = (sum * 10) % 11; return rest === 10 ? 0 : rest; };
  const first = digit(base); const second = digit([...base, first]);
  return [...base, first, second].join("");
}

async function raw(method: string, path: string, body?: unknown) {
  if (!config) throw new Error("sem configuração");
  const response = await fetch(`${ASAAS_SANDBOX_BASE_URL}${path}`, {
    method, headers: { access_token: config.apiKey, "Content-Type": "application/json", "User-Agent": "iGrow-Reports-teste" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: unknown = null;
  try { json = await response.json(); } catch { json = null; }
  return { status: response.status, json: json as Record<string, unknown> | null };
}
const keysOf = (value: unknown) => (value && typeof value === "object" ? Object.keys(value as object).sort().join(", ") : "(vazio)");
const errorsOf = (json: Record<string, unknown> | null) => JSON.stringify(((json?.errors as { code?: string; description?: string }[]) ?? []).map((error) => `${error.code}: ${error.description}`));
const report: string[] = [];
const note = (line: string) => { report.push(line); console.log(`[contrato] ${line}`); };

if (!config) console.log(`[asaas-live] Configuração do Sandbox ausente ou inválida (${problem}). Nenhuma chamada será feita. Preencha ASAAS_API_KEY em .env.asaas-sandbox.`);

live("Asaas Sandbox: contratos do cliente técnico", () => {
  const api = createAsaasClient(config!);
  const customerData = { name: `TESTE-2.2 Cliente Ficticio ${stamp}`, cpfCnpj: cpf(), email: `teste22-${stamp}@example.test`, phone: "4738010919", postalCode: "89223005", address: "Rua Teste", addressNumber: "277", province: "Centro" };
  const created: { customerId?: string; monthly?: string; yearly?: string; checkoutMonthly?: { id: string; link: string | null }; checkoutYearly?: { id: string; link: string | null } } = {};

  it("aponta só para o Sandbox e a chave é de teste", () => {
    expect(config!.baseUrl).toBe("https://api-sandbox.asaas.com/v3");
    expect(config!.apiKey.startsWith("$aact_prod_")).toBe(false);
  });

  it("autenticação: a chave é aceita pela API do Sandbox", async () => {
    const result = await raw("GET", "/customers?limit=1");
    note(`autenticação: GET /customers → HTTP ${result.status}`);
    expect(result.status, "chave recusada (401) ou conta sem acesso").toBe(200);
  });

  it("cadastro de cliente fictício (sem notificações) e consulta", async () => {
    const customer = await api.createCustomer({ ...customerData, externalReference: `teste22-${stamp}` });
    created.customerId = customer.id;
    expect(customer.id).toMatch(/^cus_/);
    const read = await raw("GET", `/customers/${customer.id}`);
    note(`cliente: criado (${customer.id.slice(0, 8)}…); campos retornados: ${keysOf(read.json)}`);
    expect(read.status).toBe(200);
    expect(read.json?.externalReference).toBe(`teste22-${stamp}`);
    expect(read.json?.notificationDisabled).toBe(true);
  });

  it("checkout hospedado por cartão: documentação x resposta real (variantes do corpo)", async () => {
    const base = {
      billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], minutesToExpire: 30,
      callback: { successUrl: "https://example.test/ok", cancelUrl: "https://example.test/cancelado", expiredUrl: "https://example.test/expirado" },
      items: [{ name: "TESTE-2.2 Plano", quantity: 1, value: 49.9 }], subscription: { cycle: "MONTHLY", nextDueDate: today }, externalReference: `intent-${stamp}`,
    };
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const variants: [string, Record<string, unknown>][] = [
      ["customer (id) + sem imagem", { ...base, customer: created.customerId }],
      ["customerData (com phoneNumber) + sem imagem", { ...base, customerData: { ...customerData, phoneNumber: customerData.phone } }],
      ["customer (id) + imageBase64", { ...base, customer: created.customerId, items: [{ ...base.items[0], imageBase64: png }] }],
    ];
    for (const [label, body] of variants) {
      const result = await raw("POST", "/checkouts", body);
      note(`checkout [${label}] → HTTP ${result.status}${result.status === 200 ? `; campos: ${keysOf(result.json)}; status=${String(result.json?.status)}; link=${result.json?.link ? "sim" : "não"}` : `; erros: ${errorsOf(result.json)}`}`);
    }
    expect(report.some((line) => line.startsWith("checkout [") && line.includes("HTTP 200"))).toBe(true);
  });

  it("nosso cliente cria o checkout mensal e o anual (cartão, recorrente) e devolve o link", async () => {
    const common = { customerId: created.customerId!, itemName: "TESTE-2.2 Plano", nextDueDate: today, minutesToExpire: 30, successUrl: "https://example.test/ok", cancelUrl: "https://example.test/cancelado", expiredUrl: "https://example.test/expirado" };
    created.checkoutMonthly = await api.createCheckout({ ...common, valueCents: 4990, cycle: "monthly", externalReference: `intent-m-${stamp}` });
    created.checkoutYearly = await api.createCheckout({ ...common, valueCents: 49900, cycle: "yearly", externalReference: `intent-y-${stamp}` });
    note(`checkout mensal/anual criados pelo nosso cliente; link mensal: ${created.checkoutMonthly.link ? new URL(created.checkoutMonthly.link).host : "ausente"}`);
    for (const checkout of [created.checkoutMonthly, created.checkoutYearly]) {
      expect(checkout.id).toMatch(/^[A-Za-z0-9_-]{4,80}$/);
      expect(checkout.link, "a resposta do checkout não trouxe 'link'").toBeTruthy();
      expect(new URL(checkout.link!).protocol).toBe("https:");
    }
    const read = await raw("GET", `/checkouts/${created.checkoutMonthly.id}`);
    note(`consulta de checkout por id: GET /checkouts/{id} → HTTP ${read.status}${read.status === 200 ? `; status=${String(read.json?.status)}` : ""}`);
  });

  it("assinatura mensal e anual (cartão de teste do Sandbox): estrutura de assinatura, cobranças e consultas", async () => {
    const holder = { name: customerData.name, email: customerData.email, cpfCnpj: customerData.cpfCnpj, postalCode: "89223005", addressNumber: "277", phone: "4738010919" };
    const card = { holderName: "TESTE DOIS PONTO DOIS", number: "4444444444444444", expiryMonth: "12", expiryYear: "2030", ccv: "123" };
    for (const [cycle, value] of [["MONTHLY", 49.9], ["YEARLY", 499]] as const) {
      const result = await raw("POST", "/subscriptions", {
        customer: created.customerId, billingType: "CREDIT_CARD", value, nextDueDate: today, cycle, description: `TESTE-2.2 ${cycle}`,
        externalReference: `sub-${cycle}-${stamp}`, creditCard: card, creditCardHolderInfo: holder, remoteIp: "127.0.0.1",
      });
      note(`assinatura ${cycle}: POST /subscriptions → HTTP ${result.status}${result.status === 200 ? `; campos: ${keysOf(result.json)}` : `; erros: ${errorsOf(result.json)}`}`);
      expect(result.status).toBe(200);
      if (cycle === "MONTHLY") created.monthly = String(result.json?.id); else created.yearly = String(result.json?.id);
    }
    const subscription: AsaasSubscription = await api.getSubscription(created.monthly!);
    expect(subscription).toMatchObject({ customer: created.customerId, value: 49.9, cycle: "MONTHLY", billingType: "CREDIT_CARD" });
    const yearly = await api.getSubscription(created.yearly!);
    expect(yearly).toMatchObject({ value: 499, cycle: "YEARLY", billingType: "CREDIT_CARD" });
    note(`assinatura: status=${subscription.status}; ciclo anual retornado como ${yearly.cycle}`);
    const payments: AsaasPayment[] = await api.listSubscriptionPayments(created.monthly!, 12);
    expect(payments.length).toBeGreaterThan(0);
    const payment = await api.getPayment(payments[0].id);
    const rawPayment = await raw("GET", `/payments/${payment.id}`);
    note(`cobrança da assinatura: status=${payment.status}; billingType=${payment.billingType}; campos: ${keysOf(rawPayment.json)}`);
    note(`cobrança: confirmedDate=${payment.confirmedDate ?? "ausente"}; paymentDate=${payment.paymentDate ?? "ausente"}; invoiceUrl=${payment.invoiceUrl ? "sim" : "não"}`);
    expect(payment.subscription).toBe(created.monthly);
    expect(payment.customer).toBe(created.customerId);
    expect(payment.billingType).toBe("CREDIT_CARD");
    const customerSubscriptions = await api.listCustomerSubscriptions(created.customerId!, 20);
    expect(customerSubscriptions.map((item) => item.id).sort()).toEqual([created.monthly, created.yearly].sort());
  });

  it("(com a chave do banco de homologação) fatos REAIS do Asaas aplicados pelo nosso código em organização fictícia", async (context) => {
    if (!process.env.HOMOLOG_SUPABASE_SECRET_KEY) { context.skip(); return; }
    const helperPath: string = "../lib-homolog.mjs";
    const { adminClient } = (await import(/* @vite-ignore */ helperPath)) as { adminClient: () => unknown };
    const admin = adminClient() as Admin;
    const OWNER = "22000000-0000-4000-8000-000000000001";
    const PLAN_VERSION = "22cccccc-0000-4000-8000-000000000001";
    const org = await admin.from("agencies").insert({ name: `TESTE-2.2 Org Asaas real ${stamp}` }).select("id").single();
    expect(org.error).toBeNull();
    const agencyId = org.data!.id;
    await admin.from("agency_users").insert({ agency_id: agencyId, user_id: OWNER, role: "owner" });
    const deps: BillingDeps = { db: asBillingDb(admin), asaas: api, environment: "sandbox", now: () => new Date() };
    const intent = await admin.rpc("billing_create_intent", { p_agency_id: agencyId, p_user_id: OWNER, p_plan_version_id: PLAN_VERSION, p_cycle: "monthly", p_request_key: `real-${stamp}`, p_environment: "sandbox" });
    expect(intent.error).toBeNull();
    await admin.rpc("billing_mark_intent", { p_intent_id: (intent.data as unknown as { intent_id: string }).intent_id, p_status: "dispatching" });
    await admin.rpc("billing_mark_intent", { p_intent_id: (intent.data as unknown as { intent_id: string }).intent_id, p_status: "awaiting_payment", p_checkout_id: created.checkoutMonthly?.id ?? `chk_real${stamp}` });
    await admin.rpc("billing_set_customer", { p_agency_id: agencyId, p_environment: "sandbox", p_asaas_customer_id: created.customerId });
    const subscription = await api.getSubscription(created.monthly!);
    const outcome = await applySubscription(deps, subscription, null);
    note(`assinatura REAL aplicada ao banco de homologação → ${outcome}`);
    expect(outcome).toBe("created");
    const payments = await api.listSubscriptionPayments(created.monthly!, 12);
    const results: string[] = [];
    for (const payment of payments) results.push(await applyPayment(deps, payment, new Date(), null, null));
    note(`cobranças REAIS aplicadas → ${results.join(", ")}; status no Asaas: ${payments.map((payment) => payment.status).join(", ")}`);
    const access = await admin.rpc("agency_billing_restricted", { p_agency_id: agencyId });
    expect(access.data).toBe(false);
    if (payments.some((payment) => ["CONFIRMED", "RECEIVED"].includes(payment.status))) expect(results).toContain("activated");
  });

  it("cancelamento (DELETE) e estado posterior da assinatura e das cobranças", async () => {
    for (const id of [created.monthly, created.yearly]) {
      if (!id) continue;
      await api.cancelSubscription(id);
      const after = await raw("GET", `/subscriptions/${id}`);
      note(`após DELETE: GET /subscriptions/${id.slice(0, 8)}… → HTTP ${after.status}; deleted=${String(after.json?.deleted)}; status=${String(after.json?.status)}`);
    }
    const second = await api.cancelSubscription(created.monthly!).then(() => "sem erro", (error: unknown) => (error instanceof AsaasError ? `HTTP ${error.status}` : "erro"));
    note(`cancelar de novo uma assinatura já removida → ${second}`);
    const payments = await raw("GET", `/subscriptions/${created.monthly}/payments`);
    note(`cobranças da assinatura removida: HTTP ${payments.status}`);
  });

  it("resumo dos contratos observados", () => {
    console.log(`\n===== CONTRATOS OBSERVADOS NO SANDBOX =====\n${report.join("\n")}\n===========================================`);
    expect(report.length).toBeGreaterThan(0);
  });
});
