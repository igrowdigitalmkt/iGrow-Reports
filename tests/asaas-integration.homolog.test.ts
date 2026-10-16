/**
 * TESTE OPERACIONAL OPT-IN (não roda no `pnpm test`): exige HOMOLOG_ASAAS_INTEGRATION=1 e os arquivos locais de homologação.
 * Contra o Supabase de HOMOLOGAÇÃO (Vault real) e o Asaas SANDBOX, executa o código REAL da aplicação: leitura das credenciais do painel pelo
 * service_role, montagem do cliente financeiro com elas e as consultas somente de leitura do Super Admin (conta e lista de webhooks).
 * Pré-requisito: a chave do Sandbox já registrada pelo painel (ver scripts/check-asaas-integration-homolog.mjs). Não imprime segredos.
 * Uso: HOMOLOG_ASAAS_INTEGRATION=1 HOMOLOG_PAYMENT_ID=pay_... node --env-file=.env.homolog --env-file=.env.asaas-sandbox node_modules/vitest/vitest.mjs run tests/asaas-integration.homolog.test.ts
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => createClient(process.env.HOMOLOG_SUPABASE_URL ?? "", process.env.HOMOLOG_SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } }) }));
import { createAsaasAdminProbe } from "@/modules/billing/asaas-client";
import { resolveBillingCredentials } from "@/modules/billing/credentials";
import { createBillingRuntime } from "@/modules/billing/server";
import { evaluateWebhook } from "@/modules/platform-admin/integrations/asaas";

const enabled = process.env.HOMOLOG_ASAAS_INTEGRATION === "1" && process.env.HOMOLOG_SUPABASE_URL?.includes("xvjvfvinnnrgnhskglvd") && process.env.ASAAS_ENVIRONMENT === "sandbox";

describe.skipIf(!enabled)("integração Asaas (homologação real: Vault + Sandbox)", () => {
  it("o serviço lê as credenciais do painel (Vault) e a trava de produção segue fechada", async () => {
    const credentials = await resolveBillingCredentials();
    expect(credentials?.source).toBe("panel");
    expect(credentials?.environment).toBe("sandbox");
    expect(credentials?.config?.baseUrl).toBe("https://api-sandbox.asaas.com/v3");
    expect(credentials?.webhookTokens.length).toBeGreaterThanOrEqual(1);
  });
  it("teste de conexão e conferência do webhook: consultas somente de leitura no Sandbox", async () => {
    const credentials = await resolveBillingCredentials();
    const probe = createAsaasAdminProbe(credentials!.probeConfig!);
    expect(await probe.accountId()).toMatch(/^[A-Za-z0-9_-]{4,80}$/);
    const { webhooks } = await probe.listWebhooks();
    expect(webhooks.length).toBeGreaterThan(0);
    // Sem webhook com o endereço procurado: "missing". Com o endereço do próprio webhook cadastrado: uma avaliação concreta (nunca exceção).
    expect(evaluateWebhook(webhooks, "https://exemplo.invalido/api/webhooks/asaas")).toBe("missing");
    expect(["ok", "incomplete_events", "no_token", "disabled", "interrupted"]).toContain(evaluateWebhook(webhooks, webhooks[0].url));
  });
  it("a camada financeira (createBillingRuntime) é montada com a chave do painel e lê um pagamento real do Sandbox", async () => {
    const runtime = await createBillingRuntime();
    expect(runtime?.environment).toBe("sandbox");
    const payment = await runtime!.asaas.getPayment(process.env.HOMOLOG_PAYMENT_ID ?? "");
    expect(payment.id).toBe(process.env.HOMOLOG_PAYMENT_ID);
  });
});
