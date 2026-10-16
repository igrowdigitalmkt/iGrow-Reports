import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const afterCallbacks: (() => Promise<void> | void)[] = [];
vi.mock("next/server", () => ({ after: (callback: () => Promise<void> | void) => { afterCallbacks.push(callback); } }));
// Credenciais do painel (Vault): por padrão nada registrado (vale a reserva das variáveis de ambiente), como antes.
let panel: unknown = { managed: false };
let panelFails = false;
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc: (name: string, args?: unknown) => name === "asaas_read_credentials" ? (panelFails ? Promise.resolve({ data: null, error: { message: "falha" } }) : Promise.resolve({ data: panel, error: null })) : rpc(name, args) }) }));
const drain = vi.fn(async () => ({ claimed: 1 }));
vi.mock("@/modules/billing/event-processor", () => ({ drainBillingEvents: (...args: unknown[]) => drain(...(args as [])) }));
vi.mock("@/modules/billing/server", () => ({ createBillingRuntime: async () => ({ db: {}, asaas: {}, environment: "sandbox" }) }));

const TOKEN = "t".repeat(40);
const KEY = "$aact_hmlg_000000000000000000000000000000000000";
const body = { id: "evt_123456", event: "PAYMENT_CONFIRMED", payment: { id: "pay_123456", subscription: "sub_123456", customerName: "Nome Pessoal" } };

async function post(payload: unknown = body, headers: Record<string, string> = { "asaas-access-token": TOKEN }, raw?: string) {
  const { POST } = await import("@/app/api/webhooks/asaas/route");
  return POST(new Request("http://localhost/api/webhooks/asaas", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: raw ?? JSON.stringify(payload) }));
}

beforeEach(() => {
  rpc.mockReset(); drain.mockClear(); afterCallbacks.length = 0; panel = { managed: false }; panelFails = false;
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

describe("webhook do Asaas com credenciais do painel (Vault)", () => {
  const PANEL_KEY = "$aact_hmlg_PAINEL00000000000000000000000000000";
  const CURRENT = "c".repeat(44);
  const PREVIOUS = "p".repeat(44);
  beforeEach(() => { rpc.mockResolvedValue({ data: { id: 9, duplicate: false }, error: null }); });
  const managed = (extra: Record<string, unknown> = {}) => { panel = { managed: true, environment: "sandbox", api_key: PANEL_KEY, webhook_token: CURRENT, webhook_token_previous: null, ...extra }; };

  it("usa o token do painel; o token das variáveis de ambiente deixa de valer quando o painel tem token", async () => {
    managed();
    expect((await post(body, { "asaas-access-token": CURRENT })).status).toBe(200);
    expect((await post(body, { "asaas-access-token": TOKEN })).status).toBe(401);
  });
  it("rotação: durante a transição os dois tokens valem; depois (anterior nulo) só o atual", async () => {
    managed({ webhook_token_previous: PREVIOUS });
    expect((await post(body, { "asaas-access-token": PREVIOUS })).status).toBe(200);
    expect((await post(body, { "asaas-access-token": CURRENT })).status).toBe(200);
    managed({ webhook_token_previous: null });
    expect((await post(body, { "asaas-access-token": PREVIOUS })).status).toBe(401);
    expect((await post(body, { "asaas-access-token": CURRENT })).status).toBe(200);
  });
  it("painel com chave mas sem token: o token das variáveis de ambiente continua valendo (reserva)", async () => {
    managed({ webhook_token: null });
    expect((await post(body, { "asaas-access-token": TOKEN })).status).toBe(200);
    expect((await post(body, { "asaas-access-token": "x".repeat(44) })).status).toBe(401);
  });
  it("o evento é gravado no ambiente do painel, não no das variáveis", async () => {
    vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
    vi.stubEnv("ASAAS_PRODUCTION_UNLOCK", "yes");
    managed({ environment: "production", api_key: "$aact_prod_" + "x".repeat(40) });
    expect((await post(body, { "asaas-access-token": CURRENT })).status).toBe(200);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_environment: "production" });
  });
  it("produção registrada no painel sem o desbloqueio: webhook inerte (503), nada é gravado", async () => {
    vi.stubEnv("ASAAS_PRODUCTION_UNLOCK", "");
    managed({ environment: "production", api_key: "$aact_prod_" + "x".repeat(40) });
    expect((await post(body, { "asaas-access-token": CURRENT })).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("falha ao ler as credenciais: fecha (503) e não cai na reserva das variáveis", async () => {
    panelFails = true;
    expect((await post()).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("token igual à chave de API é descartado: sem outro token, a rota fica inerte (503) e nada é gravado", async () => {
    managed({ webhook_token: PANEL_KEY.padEnd(40, "0"), api_key: PANEL_KEY.padEnd(40, "0") });
    expect((await post(body, { "asaas-access-token": PANEL_KEY.padEnd(40, "0") })).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});
