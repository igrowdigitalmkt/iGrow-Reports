import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AsaasConfig } from "./config";

const ID = /^[A-Za-z0-9_-]{4,80}$/;

/**
 * Erro do Asaas com a informação que importa para não duplicar cobrança:
 *  ambiguous = a requisição pode ter sido concluída no Asaas mesmo sem resposta (timeout, queda, 5xx em escrita).
 *  Uma criação ambígua NUNCA é repetida às cegas.
 */
export class AsaasError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: string | null, readonly ambiguous: boolean, readonly retryable: boolean, readonly correlationId: string) {
    super(message);
    this.name = "AsaasError";
  }
}

const customerSchema = z.object({ id: z.string().regex(ID) });
const checkoutSchema = z.object({ id: z.string().regex(ID), link: z.string().url().max(600).nullish() });
const paymentSchema = z.object({
  id: z.string().regex(ID), subscription: z.string().regex(ID).nullish(), customer: z.string().regex(ID), value: z.number().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.string().max(60), billingType: z.string().max(40),
  confirmedDate: z.string().nullish(), paymentDate: z.string().nullish(), invoiceUrl: z.string().max(600).nullish(), deleted: z.boolean().nullish(),
});
const subscriptionSchema = z.object({
  id: z.string().regex(ID), customer: z.string().regex(ID), value: z.number().positive(), cycle: z.string().max(30), status: z.string().max(30),
  billingType: z.string().max(40), deleted: z.boolean().nullish(), nextDueDate: z.string().nullish(),
  // Vínculo com o checkout hospedado (observados no Sandbox): quando presentes, precisam conferir com a nossa intenção.
  checkoutSession: z.string().max(120).nullish(), externalReference: z.string().max(200).nullish(),
});
const deletedSchema = z.object({ deleted: z.boolean().nullish(), id: z.string().nullish() });
const paymentListSchema = z.object({ data: z.array(paymentSchema), hasMore: z.boolean().nullish() });

export type AsaasPayment = z.infer<typeof paymentSchema>;
export type AsaasSubscription = z.infer<typeof subscriptionSchema>;

const subscriptionListSchema = z.object({ data: z.array(subscriptionSchema), hasMore: z.boolean().nullish() });

export type CreateCheckoutInput = {
  customerId: string; itemName: string; valueCents: number; cycle: "monthly" | "yearly"; nextDueDate: string; minutesToExpire: number;
  successUrl: string; cancelUrl: string; expiredUrl: string;
  /** Identificador interno da contratação (campo documentado do checkout; ajuda a rastrear, mas o vínculo não depende dele). */
  externalReference?: string;
  /** A referência do Asaas lista a imagem do item como obrigatória; só enviada se fornecida (pendente de confirmação no Sandbox). */
  imageBase64?: string;
};

/**
 * Dados de cobrança do cliente. Achado no Sandbox: o checkout hospedado EXIGE telefone, endereço, número, CEP e bairro do cliente
 * (a cidade é deduzida do CEP pelo Asaas). Quem contrata precisa informá-los antes do checkout.
 */
export type AsaasCustomerInput = {
  name: string; cpfCnpj: string; email: string; phone: string; postalCode: string; address: string; addressNumber: string; province: string;
  complement?: string; externalReference: string;
};

/** Operações usadas pela fundação financeira (nada além disso). */
export interface AsaasApi {
  createCustomer(input: AsaasCustomerInput): Promise<{ id: string }>;
  createCheckout(input: CreateCheckoutInput): Promise<{ id: string; link: string | null }>;
  getPayment(id: string): Promise<AsaasPayment>;
  getSubscription(id: string): Promise<AsaasSubscription>;
  listSubscriptionPayments(subscriptionId: string, limit?: number): Promise<AsaasPayment[]>;
  /** Assinaturas do cliente (inclui removidas): consulta do estado real quando o resultado de uma criação ficou desconhecido. */
  listCustomerSubscriptions(customerId: string, limit?: number): Promise<AsaasSubscription[]>;
  cancelSubscription(id: string): Promise<void>;
}

function assertId(value: string) {
  if (!ID.test(value)) throw new AsaasError("Identificador inválido.", null, "invalid_id", false, false, "local");
  return value;
}

type ClientOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

/** Chamada HTTP única ao Asaas (autenticação, tempo limite, classificação de erros). Compartilhada pelo cliente financeiro e pela verificação administrativa. */
function createRequester(config: AsaasConfig, options: ClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function request<T extends z.ZodType>(method: "GET" | "POST" | "DELETE", path: string, schema: T, body?: unknown): Promise<z.infer<T>> {
    const correlationId = randomUUID();
    const write = method !== "GET";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method, redirect: "error", signal: controller.signal, cache: "no-store",
        headers: { access_token: config.apiKey, "Content-Type": "application/json", "User-Agent": "iGrow-Reports", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Sem resposta: em escrita, o Asaas pode ter concluído a operação.
      throw new AsaasError("Sem resposta do Asaas.", null, "network", write, true, correlationId);
    } finally {
      clearTimeout(timer);
    }
    let json: unknown = null;
    try { json = await response.json(); } catch { json = null; }
    if (!response.ok) {
      const first = (json as { errors?: { code?: string }[] } | null)?.errors?.[0];
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new AsaasError(`Asaas respondeu ${response.status}.`, response.status, typeof first?.code === "string" ? first.code.slice(0, 60) : null, write && transient, transient, correlationId);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AsaasError("Resposta do Asaas em formato inesperado.", response.status, "invalid_response", write, true, correlationId);
    return parsed.data;
  }
  return request;
}

export function createAsaasClient(config: AsaasConfig, options: ClientOptions = {}): AsaasApi {
  const request = createRequester(config, options);
  return {
    createCustomer: async (input) => request("POST", "/customers", customerSchema, {
      name: input.name, cpfCnpj: input.cpfCnpj, email: input.email, phone: input.phone, postalCode: input.postalCode, address: input.address,
      addressNumber: input.addressNumber, province: input.province, ...(input.complement ? { complement: input.complement } : {}),
      externalReference: input.externalReference, notificationDisabled: true,
    }),
    async createCheckout(input) {
      // Formato conforme a documentação do checkout hospedado; detalhes finais (itens, data) a confirmar no Sandbox.
      const created = await request("POST", "/checkouts", checkoutSchema, {
        billingTypes: ["CREDIT_CARD"], chargeTypes: ["RECURRENT"], minutesToExpire: input.minutesToExpire, customer: assertId(input.customerId),
        callback: { successUrl: input.successUrl, cancelUrl: input.cancelUrl, expiredUrl: input.expiredUrl },
        // O nome do item aceita até 30 caracteres. O campo "customer" não consta no esquema da referência (só no texto): a confirmar no Sandbox.
        items: [{ name: input.itemName.slice(0, 30), quantity: 1, value: input.valueCents / 100, ...(input.imageBase64 ? { imageBase64: input.imageBase64 } : {}) }],
        ...(input.externalReference ? { externalReference: input.externalReference.slice(0, 200) } : {}),
        subscription: { cycle: input.cycle === "yearly" ? "YEARLY" : "MONTHLY", nextDueDate: input.nextDueDate },
      });
      return { id: created.id, link: created.link ?? null };
    },
    getPayment: async (id) => request("GET", `/payments/${assertId(id)}`, paymentSchema),
    getSubscription: async (id) => request("GET", `/subscriptions/${assertId(id)}`, subscriptionSchema),
    async listSubscriptionPayments(subscriptionId, limit = 12) {
      const list = await request("GET", `/subscriptions/${assertId(subscriptionId)}/payments?limit=${Math.max(1, Math.min(limit, 50))}`, paymentListSchema);
      return list.data;
    },
    async listCustomerSubscriptions(customerId, limit = 20) {
      const list = await request("GET", `/subscriptions?customer=${assertId(customerId)}&includeDeleted=true&limit=${Math.max(1, Math.min(limit, 100))}`, subscriptionListSchema);
      return list.data;
    },
    async cancelSubscription(id) { await request("DELETE", `/subscriptions/${assertId(id)}`, deletedSchema); },
  };
}

const accountStatusSchema = z.object({ id: z.string().regex(ID) });
const webhookListSchema = z.object({
  data: z.array(z.object({
    id: z.string().regex(ID), url: z.string().max(600), enabled: z.boolean(), interrupted: z.boolean().nullish(), hasAuthToken: z.boolean().nullish(),
    events: z.array(z.string().max(80)).nullish(), apiVersion: z.number().nullish(),
  })),
  hasMore: z.boolean().nullish(),
});
export type AsaasWebhookInfo = z.infer<typeof webhookListSchema>['data'][number];

/**
 * Consultas SOMENTE de leitura e SEM efeito financeiro, para o Super Admin (teste de conexão e conferência do webhook).
 * Nunca cria cobrança, cliente, assinatura, pagamento nem webhook. accountId identifica a conta (usado só para a impressão digital).
 */
export interface AsaasAdminProbe {
  accountId(): Promise<string>;
  listWebhooks(): Promise<{ webhooks: AsaasWebhookInfo[]; complete: boolean }>;
}

export function createAsaasAdminProbe(config: AsaasConfig, options: ClientOptions = {}): AsaasAdminProbe {
  const request = createRequester(config, options);
  return {
    accountId: async () => (await request('GET', '/myAccount/status', accountStatusSchema)).id,
    async listWebhooks() {
      const list = await request('GET', '/webhooks?limit=100', webhookListSchema);
      return { webhooks: list.data, complete: !list.hasMore };
    },
  };
}
