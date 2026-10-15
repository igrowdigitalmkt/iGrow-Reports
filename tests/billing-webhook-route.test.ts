import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const afterCallbacks: (() => Promise<void> | void)[] = [];
vi.mock("next/server", () => ({ after: (callback: () => Promise<void> | void) => { afterCallbacks.push(callback); } }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc }) }));
const drain = vi.fn(async () => ({ claimed: 1 }));
vi.mock("@/modules/billing/event-processor", () => ({ drainBillingEvents: (...args: unknown[]) => drain(...(args as [])) }));
vi.mock("@/modules/billing/server", () => ({ createBillingRuntime: () => ({ db: {}, asaas: {}, environment: "sandbox" }) }));

const TOKEN = "t".repeat(40);
const KEY = "$aact_hmlg_000000000000000000000000000000000000";
const body = { id: "evt_123456", event: "PAYMENT_CONFIRMED", payment: { id: "pay_123456", subscription: "sub_123456", customerName: "Nome Pessoal" } };

async function post(payload: unknown = body, headers: Record<string, string> = { "asaas-access-token": TOKEN }, raw?: string) {
  const { POST } = await import("@/app/api/webhooks/asaas/route");
  return POST(new Request("http://localhost/api/webhooks/asaas", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw ?? JSON.stringify(payload) }));
}

beforeEach(() => {
  rpc.mockReset(); drain.mockClear(); afterCallbacks.length = 0;
  vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox"); vi.stubEnv("ASAAS_API_KEY", KEY); vi.stubEnv("ASAAS_WEBHOOK_TOKEN", TOKEN);
});

describe("webhook do Asaas: receber, autenticar, validar, persistir, responder", () => {
  it("não configurado: 503 sem sequer ler o evento", async () => {
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "");
    expect((await post()).status).toBe(503);
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", TOKEN); vi.stubEnv("ASAAS_ENVIRONMENT", "production");
    expect((await post()).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("token ausente ou inválido: 401 e nada é gravado", async () => {
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, { "asaas-access-token": "x".repeat(40) })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("corpo inválido ou evento sem identificador: 400", async () => {
    expect((await post(null, { "asaas-access-token": TOKEN }, "não é json")).status).toBe(400);
    expect((await post({ event: "PAYMENT_CONFIRMED" })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("corpo grande demais: 413", async () => {
    expect((await post(null, { "asaas-access-token": TOKEN }, "x".repeat(70 * 1024))).status).toBe(413);
  });
  it("evento novo: grava (sem dados pessoais), responde 200 e agenda o processamento", async () => {
    rpc.mockResolvedValue({ data: { id: 9, duplicate: false }, error: null });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: false });
    const args = rpc.mock.calls[0][1];
    expect(rpc.mock.calls[0][0]).toBe("billing_record_event");
    expect(args).toMatchObject({ p_environment: "sandbox", p_event_id: "evt_123456", p_event_type: "PAYMENT_CONFIRMED", p_resource_type: "payment", p_resource_id: "pay_123456" });
    expect(JSON.stringify(args)).not.toContain("Nome Pessoal");
    expect(afterCallbacks).toHaveLength(1);
    await afterCallbacks[0]();
    expect(drain).toHaveBeenCalledWith(expect.anything(), { limit: 5 }); // também retoma eventos antigos pendentes
  });
  it("evento duplicado: 200 sem reprocessar", async () => {
    rpc.mockResolvedValue({ data: { id: 9, duplicate: true }, error: null });
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
    expect(afterCallbacks).toHaveLength(0);
  });
  it("não conseguiu gravar: NÃO confirma (503) para o Asaas reenviar", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "banco fora" } });
    const response = await post();
    expect(response.status).toBe(503);
    expect(afterCallbacks).toHaveLength(0);
  });
  it("falha no processamento imediato não altera a resposta: o evento já está gravado e será retomado", async () => {
    rpc.mockResolvedValue({ data: { id: 9, duplicate: false }, error: null });
    drain.mockRejectedValueOnce(new Error("falha"));
    expect((await post()).status).toBe(200);
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
  });
});
