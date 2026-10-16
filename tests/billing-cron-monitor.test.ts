import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), runtime: vi.fn(), drain: vi.fn(), reconcile: vi.fn(), config: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
vi.mock("@/modules/billing/server", () => ({ createBillingRuntime: mocks.runtime }));
vi.mock("@/modules/billing/event-processor", () => ({ drainBillingEvents: mocks.drain }));
vi.mock("@/modules/billing/reconcile", () => ({ reconcileBilling: mocks.reconcile }));
vi.mock("@/modules/billing/config", () => ({ getAsaasConfig: mocks.config, configuredBillingEnvironment: () => "sandbox" }));
import { finishCronRun, readCronHealth, startCronRun, summarizeCronResult } from "@/modules/billing/cron-monitor";
import { GET as cron } from "@/app/api/cron/billing/route";
import { GET as health } from "@/app/api/cron/billing/health/route";

const SECRET = "s".repeat(40);
const request = (token: string | null = SECRET) => new Request("https://app.test/api/cron/billing", { headers: token ? { authorization: `Bearer ${token}` } : {} });
let rpcLog: Array<{ name: string; args?: Record<string, unknown> }>;
let rpcImpl: (name: string, args?: Record<string, unknown>) => { data: unknown; error: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  rpcLog = [];
  rpcImpl = name => name === "billing_cron_start" ? { data: "run-1", error: null } : name === "billing_run_maintenance" ? { data: { subscriptions_suspended: 1 }, error: null } : { data: null, error: null };
  mocks.service.mockReturnValue({ rpc: async (name: string, args?: Record<string, unknown>) => { rpcLog.push({ name, args }); return rpcImpl(name, args); } });
  mocks.runtime.mockReturnValue({ db: {}, asaas: {}, environment: "sandbox" });
  mocks.drain.mockResolvedValue({ claimed: 2, processed: 2, ignored: 0, needs_review: 0, retry: 0, deferred: 0 });
  mocks.reconcile.mockResolvedValue({ checked: 3, remoteCanceled: 0, failed: 0, intentsChecked: 1, intentsResolved: 0, intentsVerified: 0 });
  mocks.config.mockReturnValue({ environment: "sandbox" });
});

describe("resumo da execução (só contagens)", () => {
  it("sucesso, parcial (falhas de eventos ou de reconciliação) e valores inválidos viram zero", () => {
    const ok = summarizeCronResult({ maintenance: { subscriptions_suspended: 1 }, events: { processed: 2, claimed: 2 }, reconciliation: { checked: 3, failed: 0 } });
    expect(ok).toMatchObject({ status: "success", failures: 0, items: 6 });
    const partial = summarizeCronResult({ events: { retry: 1 }, reconciliation: { failed: 2 } });
    expect(partial).toMatchObject({ status: "partial", failures: 3 });
    expect(summarizeCronResult({ events: { processed: -5, ignored: "x" } }).items).toBe(0);
    for (const value of Object.values(ok.counts)) expect(typeof value).toBe("number");
  });
  it("o monitor nunca derruba o cron: erro do banco vira null/silêncio", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "função inexistente" } }) };
    expect(await startCronRun(db, "sandbox")).toBeNull();
    await expect(finishCronRun(db, "x", { status: "success", items: 0, failures: 0, counts: {} })).resolves.toBeUndefined();
    expect(await readCronHealth(db, "sandbox")).toBeNull();
  });
});

describe("/api/cron/billing registra cada execução", () => {
  it("sem segredo ou com segredo errado: 401 e NADA é registrado nem executado", async () => {
    expect((await cron(request(null))).status).toBe(401);
    expect((await cron(request("x".repeat(40)))).status).toBe(401);
    expect(rpcLog).toEqual([]);
    expect(mocks.drain).not.toHaveBeenCalled();
  });
  it("execução completa: abre, executa as três etapas e fecha com success e contagens", async () => {
    const response = await cron(request());
    expect(response.status).toBe(200);
    expect(rpcLog.map(item => item.name)).toEqual(["billing_cron_start", "billing_run_maintenance", "billing_cron_finish"]);
    expect(rpcLog[0].args).toEqual({ p_environment: "sandbox" });
    expect(rpcLog[2].args).toMatchObject({ p_id: "run-1", p_status: "success", p_failures: 0, p_error_code: null });
    expect(JSON.stringify(rpcLog)).not.toContain(SECRET);
  });
  it("falhas parciais viram partial; exceção vira failed com código fixo (sem mensagem do erro)", async () => {
    mocks.reconcile.mockResolvedValue({ checked: 1, remoteCanceled: 0, failed: 2, intentsChecked: 0, intentsResolved: 0, intentsVerified: 0 });
    await cron(request());
    expect(rpcLog.at(-1)?.args).toMatchObject({ p_status: "partial", p_failures: 2 });
    rpcLog.length = 0;
    mocks.drain.mockRejectedValue(new Error("segredo: " + SECRET));
    const failed = await cron(request());
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain(SECRET);
    expect(rpcLog.at(-1)?.args).toEqual(expect.objectContaining({ p_status: "failed", p_error_code: "cron_exception", p_failures: 1 }));
    expect(JSON.stringify(rpcLog)).not.toContain(SECRET);
  });
  it("sem monitoramento instalado (migration ausente) o cron continua funcionando", async () => {
    rpcImpl = name => name === "billing_cron_start" ? { data: null, error: { code: "PGRST202", message: "x" } } : name === "billing_run_maintenance" ? { data: {}, error: null } : { data: null, error: { code: "PGRST202", message: "x" } };
    expect((await cron(request())).status).toBe(200);
    expect(rpcLog.map(item => item.name)).toEqual(["billing_cron_start", "billing_run_maintenance"]);
  });
  it("sem o gateway configurado: executa só a manutenção e registra", async () => {
    mocks.runtime.mockReturnValue(null);
    const response = await cron(request());
    expect((await response.json()).gateway).toBe("not_configured");
    expect(rpcLog.map(item => item.name)).toEqual(["billing_cron_start", "billing_run_maintenance", "billing_cron_finish"]);
  });
});

describe("/api/cron/billing/health para o monitor externo", () => {
  const healthRequest = (token: string | null = SECRET) => new Request("https://app.test/api/cron/billing/health", { headers: token ? { authorization: `Bearer ${token}` } : {} });
  it("autenticação igual à do cron", async () => {
    expect((await health(healthRequest(null))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await health(healthRequest())).status).toBe(503);
  });
  it("saudável = 200; alerta (sem sucesso recente, falhas seguidas, acúmulo) = 503 com as marcas; monitor ausente = 503", async () => {
    rpcImpl = () => ({ data: { ok: true, flags: [], environment: "sandbox" }, error: null });
    expect((await health(healthRequest())).status).toBe(200);
    rpcImpl = () => ({ data: { ok: false, flags: ["no_recent_success", "consecutive_failures", "events_backlog"], environment: "sandbox" }, error: null });
    const bad = await health(healthRequest());
    expect(bad.status).toBe(503);
    expect((await bad.json()).flags).toEqual(["no_recent_success", "consecutive_failures", "events_backlog"]);
    rpcImpl = () => ({ data: null, error: { code: "PGRST202", message: "x" } });
    const missing = await health(healthRequest());
    expect(missing.status).toBe(503);
    expect((await missing.json()).flags).toEqual(["monitor_unavailable"]);
    expect(rpcLog.every(item => item.name === "billing_cron_health")).toBe(true);
  });
});
