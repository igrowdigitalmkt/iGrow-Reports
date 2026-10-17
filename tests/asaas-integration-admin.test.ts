import { beforeEach, describe, expect, it, vi } from "vitest";

// Integração com o Asaas administrada pelo Super Admin: fonte única das credenciais (painel/Vault com reserva nas variáveis),
// ações de servidor (operador + MFA, validação, nada de segredo na resposta de erro) e regras puras do webhook.
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), accountId: vi.fn(), listWebhooks: vi.fn(), resolve: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/modules/platform-admin/guard", () => ({ authorizePlatformAction: mocks.authorize }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => null }));
vi.mock("@/modules/billing/credentials", () => ({ resolveBillingCredentials: mocks.resolve }));
vi.mock("@/modules/billing/asaas-client", async importOriginal => ({
  ...(await importOriginal<typeof import("@/modules/billing/asaas-client")>()),
  createAsaasAdminProbe: () => ({ accountId: mocks.accountId, listWebhooks: mocks.listWebhooks }),
}));
import { AsaasError } from "@/modules/billing/asaas-client";
import { interpretCredentials } from "@/modules/billing/credentials-core";
import { checkAsaasWebhookAction, revokePreviousWebhookTokenAction, rotateWebhookTokenAction, saveAsaasKeyAction, testAsaasConnectionAction } from "@/modules/platform-admin/integrations/actions";
import { accountFingerprint, evaluateWebhook, generateWebhookToken, REQUIRED_WEBHOOK_EVENTS, webhookUrl } from "@/modules/platform-admin/integrations/asaas";

const SANDBOX_KEY = "$aact_hmlg_" + "a".repeat(40);
const PROD_KEY = "$aact_prod_" + "b".repeat(40);
const empty = { error: null, ok: null };
const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
const authError = (status: number) => new AsaasError("x", status, null, false, false, "c");
const state = (over: Record<string, unknown> = {}) => ({ managed: false, environment: null, key_configured: false, key_changed_at: null, key_status: "unverified", key_checked_at: null, account_registered: false,
  webhook_token_configured: false, webhook_token_changed_at: null, previous_token_active: false, previous_token_expires_at: null, webhook_status: "unknown", webhook_checked_at: null,
  live_enabled: false, links: { subscriptions: 0, payments: 0, checkouts: 0, customers: 0, open_events: 0 }, last_event_at: null, events: { failed: 0, needs_review: 0, pending: 0 }, cron: { ok: true, flags: [], last_success_at: null, last_run_status: null, minutes_since_success: null }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc } });
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "platform_asaas_get_state" ? state() : null, error: null }));
  mocks.accountId.mockResolvedValue("acc_123456");
});

describe("credenciais: fonte única (painel/Vault, reserva nas variáveis)", () => {
  const env = { ASAAS_ENVIRONMENT: "sandbox", ASAAS_API_KEY: SANDBOX_KEY, ASAAS_WEBHOOK_TOKEN: "w".repeat(40) };
  it("nada registrado no painel: vale a reserva das variáveis de ambiente (comportamento anterior)", () => {
    const result = interpretCredentials({ managed: false }, env)!;
    expect(result).toMatchObject({ source: "env", environment: "sandbox", problem: null, webhookTokens: ["w".repeat(40)] });
    expect(result.config?.baseUrl).toBe("https://api-sandbox.asaas.com/v3");
    expect(interpretCredentials({ managed: false }, {})).toMatchObject({ source: "env", config: null, webhookTokens: [] });
  });
  it("painel registrado: a chave e o ambiente do painel prevalecem sobre as variáveis", () => {
    const result = interpretCredentials({ managed: true, environment: "sandbox", api_key: "$aact_hmlg_" + "z".repeat(40), webhook_token: "t".repeat(40) }, env)!;
    expect(result.source).toBe("panel");
    expect(result.config?.apiKey).toBe("$aact_hmlg_" + "z".repeat(40));
    expect(result.webhookTokens).toEqual(["t".repeat(40)]);
  });
  it("produção no painel: só opera com o desbloqueio (variável de infraestrutura); o teste de conexão não depende dele", () => {
    const raw = { managed: true, environment: "production", api_key: PROD_KEY, webhook_token: "t".repeat(40) };
    const locked = interpretCredentials(raw, {})!;
    expect(locked.config).toBeNull();
    expect(locked.problem).toBe("production_not_unlocked");
    expect(locked.probeConfig?.baseUrl).toBe("https://api.asaas.com/v3");
    const open = interpretCredentials(raw, { ASAAS_PRODUCTION_UNLOCK: "yes" })!;
    expect(open.config).toMatchObject({ environment: "production", baseUrl: "https://api.asaas.com/v3" });
  });
  it("chave de produção em ambiente Sandbox (e o inverso) é recusada mesmo vinda do painel", () => {
    expect(interpretCredentials({ managed: true, environment: "sandbox", api_key: PROD_KEY }, {})).toMatchObject({ config: null, probeConfig: null, problem: "production_key" });
    expect(interpretCredentials({ managed: true, environment: "production", api_key: SANDBOX_KEY }, { ASAAS_PRODUCTION_UNLOCK: "yes" })).toMatchObject({ config: null, problem: "sandbox_key" });
  });
  it("tokens: atual + anterior em transição; sem token no painel vale o das variáveis; token igual à chave é descartado", () => {
    const base = { managed: true, environment: "sandbox", api_key: SANDBOX_KEY };
    expect(interpretCredentials({ ...base, webhook_token: "n".repeat(40), webhook_token_previous: "o".repeat(40) }, env)!.webhookTokens).toEqual(["n".repeat(40), "o".repeat(40)]);
    expect(interpretCredentials({ ...base, webhook_token: null }, env)!.webhookTokens).toEqual(["w".repeat(40)]);
    expect(interpretCredentials({ ...base, webhook_token: SANDBOX_KEY.padEnd(40, "0"), api_key: SANDBOX_KEY.padEnd(40, "0") }, {})!.webhookTokens).toEqual([]);
    expect(interpretCredentials({ ...base, webhook_token: "curto" }, {})!.webhookTokens).toEqual([]);
  });
  it("resposta inesperada do banco fecha tudo (null), nunca cai em outra credencial", () => {
    expect(interpretCredentials(null, env)).toBeNull();
    expect(interpretCredentials({ managed: "sim" }, env)).toBeNull();
    expect(interpretCredentials({ managed: true, environment: "outro" }, env)).toBeNull();
  });
});

describe("saveAsaasKeyAction", () => {
  it("sem operador com MFA: nada é validado nem gravado", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Confirme a verificação em duas etapas para continuar." });
    expect(await saveAsaasKeyAction(empty, form({ environment: "sandbox", apiKey: SANDBOX_KEY }))).toEqual({ error: "Confirme a verificação em duas etapas para continuar.", ok: null });
    expect(mocks.accountId).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["ambiente inválido", { environment: "x", apiKey: SANDBOX_KEY }], ["chave vazia", { environment: "sandbox", apiKey: "" }], ["chave curta", { environment: "sandbox", apiKey: "abc" }],
    ["chave com espaço", { environment: "sandbox", apiKey: "$aact_hmlg_ com espaco 000000000" }], ["produção no Sandbox", { environment: "sandbox", apiKey: PROD_KEY }], ["Sandbox em produção", { environment: "production", apiKey: SANDBOX_KEY }]])("%s: recusada no servidor antes de falar com o Asaas ou o banco", async (_name, values) => {
    const result = await saveAsaasKeyAction(empty, form(values));
    expect(result.error).toBeTruthy();
    expect(mocks.accountId).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("chave recusada pelo Asaas (401): não grava e a mensagem não contém a chave", async () => {
    mocks.accountId.mockRejectedValue(authError(401));
    const result = await saveAsaasKeyAction(empty, form({ environment: "sandbox", apiKey: SANDBOX_KEY }));
    expect(result.error).toMatch(/recusou/);
    expect(JSON.stringify(result)).not.toContain(SANDBOX_KEY);
    expect(mocks.rpc.mock.calls.map(call => call[0])).not.toContain("platform_asaas_save_key");
  });
  it("falha de rede ao validar: não grava", async () => {
    mocks.accountId.mockRejectedValue(new AsaasError("x", null, "network", false, true, "c"));
    expect((await saveAsaasKeyAction(empty, form({ environment: "sandbox", apiKey: SANDBOX_KEY }))).error).toMatch(/Não foi possível falar com o Asaas/);
    expect(mocks.rpc.mock.calls.map(call => call[0])).not.toContain("platform_asaas_save_key");
  });
  it("chave válida: grava com a impressão digital da conta (nunca o identificador) e não devolve a chave", async () => {
    const result = await saveAsaasKeyAction(empty, form({ environment: "sandbox", apiKey: SANDBOX_KEY }));
    expect(result.ok).toMatch(/Sandbox registrada/);
    const call = mocks.rpc.mock.calls.find(item => item[0] === "platform_asaas_save_key")!;
    expect(call[1]).toEqual({ p_environment: "sandbox", p_api_key: SANDBOX_KEY, p_account_fingerprint: accountFingerprint("sandbox", "acc_123456"), p_confirm_same_account: false });
    expect(JSON.stringify(call[1])).not.toContain("acc_123456");
    expect(JSON.stringify(result)).not.toContain(SANDBOX_KEY);
    expect(mocks.revalidate).toHaveBeenCalledWith("/admin/integracoes/pagamentos");
  });
  it("produção: registrar a chave NÃO libera cobrança (a mensagem diz isso) e nunca envia live_enabled", async () => {
    const result = await saveAsaasKeyAction(empty, form({ environment: "production", apiKey: PROD_KEY }));
    expect(result.ok).toMatch(/NÃO libera cobranças reais/);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/live_enabled|unlock/i);
  });
  it("trocar o ambiente ativo exige confirmação", async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "platform_asaas_get_state" ? state({ environment: "sandbox", key_configured: true }) : null, error: null }));
    expect((await saveAsaasKeyAction(empty, form({ environment: "production", apiKey: PROD_KEY }))).error).toMatch(/Marque a confirmação/);
    expect(mocks.accountId).not.toHaveBeenCalled();
    expect((await saveAsaasKeyAction(empty, form({ environment: "production", apiKey: PROD_KEY, confirmEnvironment: "on" }))).ok).toBeTruthy();
  });
  it("a confirmação de mesma conta só é enviada quando marcada", async () => {
    await saveAsaasKeyAction(empty, form({ environment: "sandbox", apiKey: SANDBOX_KEY, confirmSameAccount: "on" }));
    expect(mocks.rpc.mock.calls.find(item => item[0] === "platform_asaas_save_key")![1]).toMatchObject({ p_confirm_same_account: true });
  });
  it("troca de conta bloqueada pelo banco: a mensagem em português chega ao operador; erro interno não vaza", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_asaas_save_key" ? { data: null, error: { code: "22023", message: "Esta chave pertence a OUTRA conta Asaas e já existem assinaturas." } } : { data: state(), error: null });
    expect((await saveAsaasKeyAction(empty, form({ environment: "sandbox", apiKey: SANDBOX_KEY }))).error).toMatch(/OUTRA conta Asaas/);
    mocks.rpc.mockImplementation(async (name: string) => name === "platform_asaas_save_key" ? { data: null, error: { code: "XX000", message: `interno ${SANDBOX_KEY}` } } : { data: state(), error: null });
    const result = await saveAsaasKeyAction(empty, form({ environment: "sandbox", apiKey: SANDBOX_KEY }));
    expect(result.error).toBe("Não foi possível concluir. Tente novamente.");
    expect(JSON.stringify(result)).not.toContain(SANDBOX_KEY);
  });
});

describe("testAsaasConnectionAction / checkAsaasWebhookAction", () => {
  const ready = { probeConfig: { baseUrl: "https://api-sandbox.asaas.com/v3", apiKey: SANDBOX_KEY, environment: "sandbox" } };
  it("sem operador com MFA: nada acontece", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Acesso não autorizado." });
    expect((await testAsaasConnectionAction(empty, form({}))).error).toBe("Acesso não autorizado.");
    expect((await checkAsaasWebhookAction(empty, form({}))).error).toBe("Acesso não autorizado.");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("configuração incompleta: informa e não chama o Asaas", async () => {
    mocks.resolve.mockResolvedValue({ probeConfig: null });
    expect((await testAsaasConnectionAction(empty, form({}))).error).toMatch(/Configuração incompleta/);
    expect(mocks.accountId).not.toHaveBeenCalled();
  });
  it("conectado / falha de autenticação / falha de comunicação, cada um registrado sem detalhes sensíveis", async () => {
    mocks.resolve.mockResolvedValue(ready);
    expect((await testAsaasConnectionAction(empty, form({}))).ok).toMatch(/^Conectado/);
    mocks.accountId.mockRejectedValueOnce(authError(401));
    expect((await testAsaasConnectionAction(empty, form({}))).error).toMatch(/Falha de autenticação/);
    mocks.accountId.mockRejectedValueOnce(authError(503));
    expect((await testAsaasConnectionAction(empty, form({}))).error).toMatch(/Falha de comunicação/);
    const checks = mocks.rpc.mock.calls.filter(call => call[0] === "platform_asaas_record_check").map(call => call[1]);
    expect(checks).toEqual([{ p_kind: "connection", p_status: "connected" }, { p_kind: "connection", p_status: "auth_failed" }, { p_kind: "connection", p_status: "unreachable" }]);
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(SANDBOX_KEY);
  });
  it("o teste usa só consulta de leitura: nenhuma função financeira do cliente é chamada", async () => {
    mocks.resolve.mockResolvedValue(ready);
    await testAsaasConnectionAction(empty, form({}));
    expect(mocks.listWebhooks).not.toHaveBeenCalled();
    expect(mocks.accountId).toHaveBeenCalledTimes(1);
  });
  it("conferência do webhook: lê a lista e registra o resultado; nunca escreve no Asaas", async () => {
    mocks.resolve.mockResolvedValue(ready);
    mocks.listWebhooks.mockResolvedValue({ webhooks: [{ id: "wh_000001", url: webhookUrl(), enabled: true, interrupted: false, hasAuthToken: true, events: [...REQUIRED_WEBHOOK_EVENTS] }], complete: true });
    expect((await checkAsaasWebhookAction(empty, form({}))).ok).toMatch(/ativo, com token/);
    mocks.listWebhooks.mockResolvedValue({ webhooks: [], complete: true });
    expect((await checkAsaasWebhookAction(empty, form({}))).error).toMatch(/Cadastre-o manualmente/);
    expect(mocks.rpc.mock.calls.filter(call => call[0] === "platform_asaas_record_check").map(call => call[1])).toEqual([{ p_kind: "webhook", p_status: "ok" }, { p_kind: "webhook", p_status: "missing" }]);
  });
});

describe("rotação do token do webhook", () => {
  it("sem operador com MFA: nenhum token é gerado ou gravado", async () => {
    mocks.authorize.mockResolvedValue({ ok: false, error: "Sua sessão expirou. Entre novamente." });
    expect((await rotateWebhookTokenAction(empty, form({}))).secret).toBeUndefined();
    expect((await revokePreviousWebhookTokenAction(empty, form({}))).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("gera token forte, grava com o prazo de transição e o devolve UMA vez (o mesmo que foi gravado)", async () => {
    const result = await rotateWebhookTokenAction(empty, form({ graceMinutes: "240" }));
    const call = mocks.rpc.mock.calls[0];
    expect(call[0]).toBe("platform_asaas_rotate_webhook_token");
    expect(call[1].p_grace_minutes).toBe(240);
    expect(call[1].p_token).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(result.secret).toBe(call[1].p_token);
    expect(result.ok).toMatch(/não será exibido novamente/);
  });
  it("transição fora de 0 a 1440 é recusada; erro do banco não devolve token", async () => {
    expect((await rotateWebhookTokenAction(empty, form({ graceMinutes: "2000" }))).error).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "falha" } });
    const failed = await rotateWebhookTokenAction(empty, form({}));
    expect(failed.secret).toBeUndefined();
  });
  it("tokens gerados são diferentes e nunca parecem chave de API", () => {
    const a = generateWebhookToken();
    const b = generateWebhookToken();
    expect(a).not.toBe(b);
    expect(a.startsWith("$aact")).toBe(false);
  });
});

describe("regras puras do webhook e da conta", () => {
  const url = webhookUrl("https://groowads.com/");
  const hook = (over: Record<string, unknown> = {}) => ({ id: "wh_000001", url, enabled: true, interrupted: false, hasAuthToken: true, events: [...REQUIRED_WEBHOOK_EVENTS], ...over });
  it("endereço oficial do webhook", () => {
    expect(url).toBe("https://groowads.com/api/webhooks/asaas");
    expect(webhookUrl(undefined)).toBe("https://groowads.com/api/webhooks/asaas");
  });
  it.each([["ok", [hook()]], ["missing", []], ["missing", [hook({ url: "https://outro.exemplo/api/webhooks/asaas" })]], ["duplicate", [hook(), hook({ id: "wh_000002" })]], ["disabled", [hook({ enabled: false })]],
    ["interrupted", [hook({ interrupted: true })]], ["no_token", [hook({ hasAuthToken: false })]], ["incomplete_events", [hook({ events: ["PAYMENT_CREATED"] })]]])("avaliação %s", (expected, hooks) => {
    expect(evaluateWebhook(hooks as never, url)).toBe(expected);
  });
  it("impressão digital: estável, por ambiente e sem o identificador", () => {
    expect(accountFingerprint("sandbox", "acc_1")).toBe(accountFingerprint("sandbox", "acc_1"));
    expect(accountFingerprint("sandbox", "acc_1")).not.toBe(accountFingerprint("production", "acc_1"));
    expect(accountFingerprint("sandbox", "acc_1")).toMatch(/^[0-9a-f]{64}$/);
    expect(accountFingerprint("sandbox", "acc_1")).not.toContain("acc_1");
  });
});
