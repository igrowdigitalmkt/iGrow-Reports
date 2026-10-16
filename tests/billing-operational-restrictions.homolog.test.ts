/**
 * TESTE OPERACIONAL OPT-IN (não roda no `pnpm test`): exige HOMOLOG_OPERATIONAL_PHASE e os arquivos locais de homologação.
 * Prova, contra o Supabase de HOMOLOGAÇÃO, que a restrição financeira IMPEDE as operações (não só que o banco devolve "restricted"):
 *  - chamadas diretas à API do Supabase com a sessão do proprietário (gatilhos de limite e RLS);
 *  - execução REAL de `runGuardedGeneration` (IA) e `executeAutomation` (agendamentos) com remetentes/provedor falsos: nenhuma
 *    entrega externa e nenhum crédito de IA são possíveis; o que se conta é se o mecanismo CHEGOU a pedir o envio/a chamada.
 * Organizações fictícias TESTE-2.2O (estado variável) e TESTE-2.2P (controle sempre ativo). Uso:
 *   HOMOLOG_OPERATIONAL_PHASE=<active|tolerance|suspended|restored|canceled_vigent|ended> node --env-file=.env.homolog --env-file=.env.asaas-sandbox --env-file=.env.homolog-teste22o --env-file=.env.homolog-teste22p node_modules/vitest/vitest.mjs run tests/billing-operational-restrictions.homolog.test.ts
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// O guard e as funções de sincronização usam o cliente de serviço da aplicação: aqui ele aponta para o banco de HOMOLOGAÇÃO.
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => createClient(process.env.HOMOLOG_SUPABASE_URL ?? "", process.env.HOMOLOG_SUPABASE_SECRET_KEY ?? "", { auth: { persistSession: false, autoRefreshToken: false } }) }));
import { runGuardedGeneration } from "@/modules/ai/guarded-text";
import { executeAutomation } from "@/modules/automations/runner";
import { BillingRestrictedError, paidOperationBlock } from "@/modules/billing/guard";
import { getClientAccountBilling, getMetaEntityStatuses } from "@/modules/meta/server";

const phase = process.env.HOMOLOG_OPERATIONAL_PHASE;
const ALLOWED_PHASES = new Set(["active", "tolerance", "restored", "canceled_vigent"]);
const BLOCKED_PHASES = new Set(["suspended", "ended"]);
const url = process.env.HOMOLOG_SUPABASE_URL ?? "";
const publishable = process.env.HOMOLOG_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.HOMOLOG_SUPABASE_SECRET_KEY ?? "";
const orgO = process.env.TESTE22O_ORG_ID ?? "";
const orgP = process.env.TESTE22P_ORG_ID ?? "";

const plain = { auth: { persistSession: false, autoRefreshToken: false } };
const as = async (email: string, password: string) => {
  const client = createClient(url, publishable, plain);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error("login de teste falhou");
  return client;
};

describe.skipIf(!phase)(`restrições operacionais — fase ${phase}`, { timeout: 60_000 }, () => {
  // Limpeza dos clientes criados pelas fases anteriores (só os desta bateria, só nas organizações fictícias), para não esgotar o limite do plano.
  it("limpeza prévia dos clientes de teste das fases anteriores", async () => {
    const service = createClient(url, secret, plain);
    for (const [agency, prefix] of [[orgO, "Cliente "], [orgP, "Controle "]] as const) {
      const rows = await service.from("clients").select("id,name").eq("agency_id", agency).like("name", `${prefix}%`).neq("name", "Cliente fixture operacional");
      for (const row of rows.data ?? []) await service.from("clients").delete().eq("id", row.id);
    }
  });

  const allowed = ALLOWED_PHASES.has(phase ?? "");
  // O corpo do describe também roda quando a bateria é ignorada: as validações só valem com a fase informada.
  if (phase) {
    if (!allowed && !BLOCKED_PHASES.has(phase)) throw new Error("Fase desconhecida.");
    if (!url.includes("xvjvfvinnnrgnhskglvd") || url.includes("qlopniyghvpbgwxuwxrl")) throw new Error("Somente o projeto de HOMOLOGAÇÃO.");
  }

  it("chamadas diretas à API com a sessão do proprietário: criação de clientes e convites segue o estado financeiro", async () => {
    const owner = await as(process.env.TESTE22O_OWNER_EMAIL!, process.env.TESTE22O_OWNER_PASSWORD!);
    const stamp = `${phase}-${Date.now().toString(36)}`;
    const client = await owner.from("clients").insert({ agency_id: orgO, name: `Cliente ${stamp}` }).select("id").single();
    // Convites só nascem no servidor (a sessão do usuário não escreve em agency_invitations: RLS); o gatilho vale para o servidor também.
    const direct = await owner.from("agency_invitations").insert({ agency_id: orgO, email: `direto-${stamp}@example.test`, role: "editor", token_hash: createHash("sha256").update(`d-${stamp}`).digest("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString() }).select("id").single();
    expect(direct.error?.code).toBe("42501");
    const server = createClient(url, secret, plain);
    const invite = await server.from("agency_invitations").insert({ agency_id: orgO, email: `convite-${stamp}@example.test`, role: "editor", token_hash: createHash("sha256").update(`s-${stamp}`).digest("hex"), expires_at: new Date(Date.now() + 86_400_000).toISOString() }).select("id").single();
    if (allowed) {
      expect(client.error).toBeNull();
      expect(invite.error).toBeNull();
    } else {
      expect(client.error?.code).toBe("53400");
      expect(invite.error?.code).toBe("53400");
    }
    // Dados existentes preservados e legíveis em qualquer estado.
    const existing = await owner.from("clients").select("id,name").eq("agency_id", orgO);
    expect(existing.error).toBeNull();
    expect((existing.data ?? []).some(row => row.name === "Cliente fixture operacional")).toBe(true);
    // Os direitos efetivos acompanham o estado.
    const rights = await owner.rpc("get_agency_entitlements", { p_agency_id: orgO });
    expect(rights.error).toBeNull();
    expect((rights.data as Array<{ key: string; enabled: boolean }>).find(item => item.key === "ai_assistant")?.enabled).toBe(allowed);
  });

  it("isolamento: o proprietário de O não age em P, e a restrição de O não afeta P", async () => {
    const ownerO = await as(process.env.TESTE22O_OWNER_EMAIL!, process.env.TESTE22O_OWNER_PASSWORD!);
    const ownerP = await as(process.env.TESTE22P_OWNER_EMAIL!, process.env.TESTE22P_OWNER_PASSWORD!);
    const cross = await ownerO.from("clients").insert({ agency_id: orgP, name: "Invasão" }).select("id").single();
    expect(cross.error).not.toBeNull();
    expect(cross.data).toBeNull();
    // Consultas de direitos e de cobrança de outra organização são recusadas; a função de restrição é só do servidor.
    expect((await ownerO.rpc("get_agency_entitlements", { p_agency_id: orgP })).error?.code).toBe("42501");
    expect((await ownerO.rpc("get_agency_billing", { p_agency_id: orgP })).error).not.toBeNull();
    expect((await ownerO.rpc("agency_billing_restricted", { p_agency_id: orgO })).error).not.toBeNull();
    expect((await createClient(url, publishable, plain).rpc("agency_billing_restricted", { p_agency_id: orgO })).error).not.toBeNull();
    const own = await ownerP.from("clients").insert({ agency_id: orgP, name: `Controle ${phase}-${Date.now().toString(36)}` }).select("id").single();
    expect(own.error).toBeNull();
  });

  it("IA: execução real de runGuardedGeneration; o provedor só é chamado quando a organização tem direito (nenhum crédito real)", async () => {
    const service = createClient(url, secret, plain);
    let providerCalls = 0;
    const anthropic = { messages: { create: async () => { providerCalls += 1; return { id: "msg_falsa", type: "message", role: "assistant", model: "falso", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: "Resumo sem números.", citations: null }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never; } } };
    const run = (agencyId: string) => runGuardedGeneration({ agencyId, clientId: null, userId: null, feature: "portfolio_summary", system: "teste", factsText: "{}", factsLabel: "Fatos:", sourceRef: "teste-operacional" }, { anthropic, supabase: service });
    const result = await run(orgO);
    if (allowed) { expect(result.ok).toBe(true); expect(providerCalls).toBe(1); }
    else {
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe("disabled");
      expect(result.ok === false && result.message).toMatch(/acesso desta organização está restrito/);
      expect(providerCalls).toBe(0);
    }
    const before = providerCalls;
    const control = await run(orgP); // P nunca é restrita
    expect(control.ok).toBe(true);
    expect(providerCalls).toBe(before + 1);
  });

  it("agendamentos: execução real de executeAutomation; a restrição vale ANTES de resolver remetente, ler números ou enviar", async () => {
    const service = createClient(url, secret, plain);
    const found = await service.from("report_automations").select("*").eq("agency_id", orgO).eq("name", "Agendamento fixture").single();
    expect(found.error).toBeNull();
    let senderRequests = 0; let deliveries = 0;
    const resolveSender = async () => { senderRequests += 1; return { send: async () => { deliveries += 1; return { ok: true }; } } as never; };
    const today = new Date().toISOString().slice(0, 10);
    const outcome = await executeAutomation(service, found.data!, { scheduledFor: new Date(), period: { dateFrom: today, dateTo: today }, trigger: "manual" }, { resolveSender, appUrl: null });
    expect(outcome).not.toBeNull();
    expect(deliveries).toBeLessThanOrEqual(0 + (allowed ? 1 : 0));
    if (allowed) {
      expect(senderRequests).toBe(1); // passou pela trava financeira e chegou a pedir o remetente (falso: nada é entregue de verdade)
    } else {
      expect(outcome!.status).toBe("skipped");
      expect(outcome!.message).toMatch(/acesso desta organização está restrito/);
      expect(senderRequests).toBe(0);
      expect(deliveries).toBe(0);
    }
    // Nada é refeito depois: nenhuma execução desta organização foi marcada como enviada.
    const runs = await service.from("report_automation_runs").select("status").eq("automation_id", found.data!.id);
    expect((runs.data ?? []).some(row => row.status === "sent")).toBe(false);
  });

  it("operações pagas (guard REAL contra o banco real): restrita é barrada antes de qualquer chamada ao provedor; a organização de controle segue liberada", async () => {
    const block = await paidOperationBlock(orgO);
    expect(block === null).toBe(allowed);
    expect(await paidOperationBlock(orgP)).toBeNull();
    const clientId = "00000000-0000-4000-8000-0000000000c1";
    const outcome = await getClientAccountBilling({ agencyId: orgO, clientId }).then(() => null, error => error);
    if (allowed) expect(outcome).not.toBeInstanceOf(BillingRestrictedError);
    else expect(outcome).toBeInstanceOf(BillingRestrictedError);
    if (!allowed) expect(await getMetaEntityStatuses({ agencyId: orgO, clientId, accountIds: ["a"] })).toEqual({});
    const control = await getClientAccountBilling({ agencyId: orgP, clientId }).then(() => null, error => error);
    expect(control).not.toBeInstanceOf(BillingRestrictedError);
  });
});
