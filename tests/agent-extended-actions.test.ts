import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ctx = vi.hoisted(() => ({ role: "owner" as string }));
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: async () => ({ role: ctx.role, user: { id: "u1" }, agency: { id: "ag" } }) }));
const state = vi.hoisted(() => ({ gate: true, supported: true, probeError: false, rows: [] as Record<string, unknown>[], moves: [] as string[] }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async (name: string) => name === "agent_manual_extended_actions_supported"
      ? { data: state.supported, error: state.probeError ? { code: "PGRST202" } : null } : { data: state.gate, error: null },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      for (const m of ["select", "eq", "is"]) q[m] = () => q;
      q.maybeSingle = () => patch ? (state.moves.push(String(patch.status)), Promise.resolve({ data: { id: "x" }, error: null }))
        : Promise.resolve({ data: table === "client_ad_accounts" ? { active: true } : { id: "x" }, error: null });
      q.update = (p: Record<string, unknown>) => { patch = p; return q; };
      q.insert = (row: Record<string, unknown>) => { state.rows.push(row); return Promise.resolve({ error: null }); };
      return q;
    },
  }),
}));
const exec = vi.hoisted(() => vi.fn(async () => "verified"));
vi.mock("@/modules/agent-executor/scheduler", () => ({ executeQueuedJobNow: exec }));

import { requestManualMetaChange } from "@/modules/agent-executor/manual-actions";
import { executeMetaWrite } from "@/modules/agent-executor/meta-write";
import { ACTIONS, MANUAL_ACTIONS, MANUAL_ONLY_ACTIONS, actionLevel, evaluateDelegatedAction, isBudgetSensitiveAction, proposalSchema, validateEntityName } from "@/modules/agent-executor/policy";
import { DECISION_TOOL } from "@/modules/agent-executor/decision-contract";

const now = new Date("2026-10-21T12:00:00Z");
const agencyId = "10000000-0000-4000-8000-000000000001", clientId = "20000000-0000-4000-8000-000000000002", id = "30000000-0000-4000-8000-000000000003";
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function input(action: string, extra: Record<string, unknown> = {}, contextOver: Record<string, unknown> = {}) {
  return {
    token: "test-token-not-real", targetId: "111", apiVersion: "v26.0",
    proposal: { actionId: id, action, targetId: "111", adAccountId: "act_123", factsCollectedAt: "2026-10-21T11:50:00Z", rationale: "Alteracao manual solicitada por usuario autenticado", ...extra },
    delegation: { agencyId, clientId, adAccountId: "act_123", enabled: true, revokedAt: null, expiresAt: "2026-10-21T12:05:00Z", allowedActions: [action],
      maxAccountDailyBudgetMinor: 1_000_000_000_000, maxEntityDailyBudgetMinor: 1_000_000_000_000, maxIncreaseMinorPerAction: 1_000_000_000_000, maxIncreasePercentPerAction: 1000 },
    context: { agencyId, clientId, adAccountId: "act_123", currency: "BRL", hasWritePermission: true, userMayDelegate: true, commercialAccessActive: true, metaConnectionActive: true,
      confirmedActiveDailyBudgetMinor: null, budgetCoverageComplete: false, ...contextOver },
  };
}
const campaign = { id: "111", account_id: "123", name: "Campanha antiga", status: "ACTIVE", daily_budget: "5000", objective: "OUTCOME_LEADS" };
const adset = { id: "111", account_id: "123", name: "Conjunto antigo", status: "ACTIVE", campaign_id: "900" };
const ad = { id: "111", account_id: "123", name: "Anuncio antigo", status: "ACTIVE", adset_id: "800" };

describe("contratos: ações novas são só manuais", () => {
  it("a lista da IA continua com as seis ações anteriores; o contrato de decisão não expõe as novas", () => {
    expect([...ACTIONS]).toEqual(["pause_campaign", "resume_campaign", "pause_adset", "resume_adset", "set_campaign_daily_budget", "set_adset_daily_budget"]);
    expect([...MANUAL_ONLY_ACTIONS]).toEqual(["rename_campaign", "rename_adset", "rename_ad", "pause_ad", "resume_ad"]);
    expect(MANUAL_ACTIONS).toHaveLength(11);
    const toolActions = (DECISION_TOOL as unknown as { input_schema: { properties: { recommendations: { items: { properties: { action: { enum: string[] } } } } } } }).input_schema.properties.recommendations.items.properties.action.enum;
    for (const action of MANUAL_ONLY_ACTIONS) expect(toolActions).not.toContain(action);
  });
  it("nível e sensibilidade financeira de cada ação", () => {
    expect(MANUAL_ACTIONS.map(action => `${action}:${actionLevel(action)}`)).toEqual([
      "pause_campaign:campaign", "resume_campaign:campaign", "pause_adset:adset", "resume_adset:adset", "set_campaign_daily_budget:campaign", "set_adset_daily_budget:adset",
      "rename_campaign:campaign", "rename_adset:adset", "rename_ad:ad", "pause_ad:ad", "resume_ad:ad"]);
    expect(MANUAL_ACTIONS.filter(isBudgetSensitiveAction)).toEqual(["resume_campaign", "resume_adset", "set_campaign_daily_budget", "set_adset_daily_budget"]);
  });
  it("schema da proposta: nome só em renomear e válido; orçamento só em set_*", () => {
    const base = { actionId: id, targetId: "111", adAccountId: "act_123", factsCollectedAt: "2026-10-21T11:50:00Z", rationale: "Alteracao manual solicitada por usuario" };
    expect(proposalSchema.safeParse({ ...base, action: "rename_ad", newName: "Novo" }).success).toBe(true);
    expect(proposalSchema.safeParse({ ...base, action: "rename_ad" }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, action: "pause_ad", newName: "Novo" }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, action: "rename_ad", newName: "  " }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, action: "pause_ad", dailyBudgetMinor: 100 }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, action: "delete_ad" }).success).toBe(false);
    expect(proposalSchema.safeParse({ ...base, action: "rename_ad", newName: "Novo", payload: { status: "ACTIVE" } }).success).toBe(false);
  });
  it("validação de nome: vazio, tamanho, controle, igual ao atual e espaços", () => {
    expect(validateEntityName("  Novo nome  ", "Antigo")).toEqual({ ok: true, name: "Novo nome" });
    for (const bad of ["", "   ", "a".repeat(201), "linha\nquebrada", "tab\there", "\u0000x"]) expect(validateEntityName(bad).ok).toBe(false);
    expect(validateEntityName("a".repeat(200)).ok).toBe(true);
    expect(validateEntityName("Igual", "Igual")).toEqual({ ok: false, message: "O novo nome é igual ao atual." });
    expect(validateEntityName(" Igual ", "Igual").ok).toBe(false);
    expect(validateEntityName(42 as never).ok).toBe(false);
    expect(validateEntityName("Acentuação ✓ — 100% [teste]").ok).toBe(true);
  });
});

describe("renomear: GET → política → POST restrito → GET confirma o nome", () => {
  it.each([["rename_campaign", campaign, "Campanha nova", "id,account_id,name,status,daily_budget,objective"],
    ["rename_adset", adset, "Conjunto novo", "id,account_id,name,status,daily_budget,campaign_id"],
    ["rename_ad", ad, "Anuncio novo", "id,account_id,name,status,adset_id"]] as const)("%s", async (action, entity, name, fields) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(entity)).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response({ ...entity, name }));
    const result = await executeMetaWrite(input(action, { newName: name }), { fetchImpl, now: () => now });
    expect(result).toEqual({ status: "verified", actionId: id, metaEntityId: "111" });
    expect(fetchImpl.mock.calls.map(c => c[1].method)).toEqual(["GET", "POST", "GET"]);
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("fields")).toBe(fields);
    expect(String(fetchImpl.mock.calls[1][0])).toBe("https://graph.facebook.com/v26.0/111");
    expect(fetchImpl.mock.calls[1][1].body.toString()).toBe(new URLSearchParams({ name }).toString());
    expect(String(fetchImpl.mock.calls[1][0])).not.toContain("test-token");
  });
  it("não exige orçamento nem inventário financeiro (contexto sem orçamento confirmado)", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ ...campaign, daily_budget: undefined })).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response({ ...campaign, daily_budget: undefined, name: "Outro" }));
    expect((await executeMetaWrite(input("rename_campaign", { newName: "Outro" }), { fetchImpl, now: () => now })).status).toBe("verified");
  });
  it("nome igual ao atual, nome vazio e campo inesperado nunca chegam ao POST", async () => {
    for (const extra of [{ newName: "Campanha antiga" }, { newName: "  " }, { newName: "Ok", dailyBudgetMinor: 100 }, {}]) {
      const fetchImpl = vi.fn().mockResolvedValue(response(campaign));
      const result = await executeMetaWrite(input("rename_campaign", extra), { fetchImpl, now: () => now });
      expect(result.status).toBe("blocked");
      expect(fetchImpl.mock.calls.filter(c => c[1].method === "POST")).toHaveLength(0);
    }
  });
  it("HTTP 200 do POST não basta: se a leitura posterior mostra o nome antigo, fica aguardando verificação", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(campaign)).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response(campaign));
    const result = await executeMetaWrite(input("rename_campaign", { newName: "Campanha nova" }), { fetchImpl, now: () => now });
    expect(result.status).toBe("needs_verification");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // nada é reenviado
  });
  it("timeout/erro no POST e falha na confirmação: resultado desconhecido, sem repetir o POST", async () => {
    const down = vi.fn().mockResolvedValueOnce(response(campaign)).mockRejectedValueOnce(new Error("timeout"));
    expect((await executeMetaWrite(input("rename_campaign", { newName: "Novo" }), { fetchImpl: down, now: () => now })).status).toBe("needs_verification");
    expect(down).toHaveBeenCalledTimes(2);
    const refused = vi.fn().mockResolvedValueOnce(response(campaign)).mockResolvedValueOnce(response({ error: { code: 1 } }, 500));
    expect((await executeMetaWrite(input("rename_campaign", { newName: "Novo" }), { fetchImpl: refused, now: () => now })).status).toBe("needs_verification");
    const noConfirm = vi.fn().mockResolvedValueOnce(response(campaign)).mockResolvedValueOnce(response({ success: true })).mockRejectedValueOnce(new Error("rede"));
    expect((await executeMetaWrite(input("rename_campaign", { newName: "Novo" }), { fetchImpl: noConfirm, now: () => now })).status).toBe("needs_verification");
  });
  it("entidade, conta e tipo incorretos: bloqueado sem POST", async () => {
    for (const [action, entity] of [["rename_campaign", { ...campaign, account_id: "999" }], ["rename_campaign", adset], ["rename_adset", campaign], ["rename_ad", campaign], ["rename_ad", { ...ad, adset_id: undefined }], ["rename_ad", { ...ad, id: "222" }]] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(response(entity));
      expect((await executeMetaWrite(input(action, { newName: "Novo" }), { fetchImpl, now: () => now })).status).toBe("blocked");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it("sem permissão de escrita, conta sem acesso comercial ou conexão inativa: bloqueado sem POST", async () => {
    for (const over of [{ hasWritePermission: false }, { commercialAccessActive: false }, { metaConnectionActive: false }]) {
      const fetchImpl = vi.fn().mockResolvedValue(response(campaign));
      expect((await executeMetaWrite(input("rename_campaign", { newName: "Novo" }, over), { fetchImpl, now: () => now })).status).toBe("blocked");
      expect(fetchImpl.mock.calls.filter(c => c[1].method === "POST")).toHaveLength(0);
    }
  });
  it("estado ARCHIVED/DELETED não permite renomear por aqui", async () => {
    for (const status of ["ARCHIVED", "DELETED", "WITH_ISSUES"]) {
      const fetchImpl = vi.fn().mockResolvedValue(response({ ...campaign, status }));
      expect((await executeMetaWrite(input("rename_campaign", { newName: "Novo" }), { fetchImpl, now: () => now })).status).toBe("blocked");
    }
  });
  it("política direta: nome atual não confirmado bloqueia", () => {
    const base = input("rename_campaign", { newName: "Novo" });
    const result = evaluateDelegatedAction({ ...base, now, entity: { id: "111", adAccountId: "act_123", level: "campaign", configuredStatus: "ACTIVE", name: null, dailyBudgetMinor: null, fetchedAt: now.toISOString() } });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("anúncios: pausar e retomar", () => {
  it("pausar anúncio: GET → POST status=PAUSED → GET confirma", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(ad)).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response({ ...ad, status: "PAUSED" }));
    expect(await executeMetaWrite(input("pause_ad"), { fetchImpl, now: () => now })).toEqual({ status: "verified", actionId: id, metaEntityId: "111" });
    expect(fetchImpl.mock.calls[1][1].body.toString()).toBe("status=PAUSED");
  });
  it("retomar anúncio: sem orçamento/inventário (anúncio não tem), exige estar pausado", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ ...ad, status: "PAUSED" })).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response(ad));
    expect((await executeMetaWrite(input("resume_ad"), { fetchImpl, now: () => now })).status).toBe("verified");
    expect(fetchImpl.mock.calls[1][1].body.toString()).toBe("status=ACTIVE");
  });
  it("estado incompatível (já pausado/ativo, arquivado) não envia POST", async () => {
    for (const [action, status] of [["pause_ad", "PAUSED"], ["resume_ad", "ACTIVE"], ["pause_ad", "ARCHIVED"], ["resume_ad", "DELETED"]] as const) {
      const fetchImpl = vi.fn().mockResolvedValue(response({ ...ad, status }));
      expect((await executeMetaWrite(input(action), { fetchImpl, now: () => now })).status).toBe("blocked");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it("confirmação ausente ou divergente vira aguardando verificação; falha antes do POST (preflight) não envia nada", async () => {
    const stale = vi.fn().mockResolvedValueOnce(response(ad)).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response(ad));
    expect((await executeMetaWrite(input("pause_ad"), { fetchImpl: stale, now: () => now })).status).toBe("needs_verification");
    const fetchImpl = vi.fn().mockResolvedValue(response(ad));
    const result = await executeMetaWrite(input("pause_ad"), { fetchImpl, now: () => now, beforePost: async () => { throw new Error("ledger"); } });
    expect(result).toMatchObject({ status: "blocked" });
    expect(fetchImpl.mock.calls.filter(c => c[1].method === "POST")).toHaveLength(0);
  });
  it("permissão revogada, conta restrita ou conexão inativa: nada é enviado", async () => {
    for (const over of [{ hasWritePermission: false }, { metaConnectionActive: false }, { commercialAccessActive: false }]) {
      const fetchImpl = vi.fn().mockResolvedValue(response(ad));
      expect((await executeMetaWrite(input("pause_ad", {}, over), { fetchImpl, now: () => now })).status).toBe("blocked");
    }
  });
  it("registra o nome antes e depois no ledger (before/after) via ganchos", async () => {
    const before = vi.fn(async () => {}), after = vi.fn(async () => {});
    const fetchImpl = vi.fn().mockResolvedValueOnce(response(ad)).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response({ ...ad, status: "PAUSED" }));
    await executeMetaWrite(input("pause_ad"), { fetchImpl, now: () => now, beforePost: before, afterVerified: after });
    expect(before).toHaveBeenCalledWith(expect.objectContaining({ action: "pause_ad" }), expect.objectContaining({ status: "ACTIVE", name: "Anuncio antigo" }));
    expect(after).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "PAUSED", name: "Anuncio antigo" }));
  });
});

describe("pedido manual das ações novas (servidor)", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    requestId: "10000000-0000-4000-8000-000000000001", clientId: "20000000-0000-4000-8000-000000000002",
    adAccountId: "30000000-0000-4000-8000-000000000003", action: "rename_campaign", targetId: "555", newName: "Nome novo", ...over });
  beforeEach(() => { exec.mockClear(); Object.assign(state, { gate: true, supported: true, probeError: false, rows: [], moves: [] }); ctx.role = "owner"; });

  it("registra job manual com o novo nome (aparado), sem delegação nem aprovação de IA", async () => {
    const result = await requestManualMetaChange(request({ newName: "  Nome novo  " }));
    expect(result.ok).toBe(true);
    expect(state.rows[0]).toMatchObject({ execution_origin: "manual", delegation_id: null, action_type: "rename_campaign", new_name: "Nome novo", daily_budget_minor: null });
    expect(state.moves).toEqual(["authorized", "queued"]);
  });
  it.each(["pause_ad", "resume_ad", "rename_adset", "rename_ad"])("aceita %s quando o banco suporta", async action => {
    const result = await requestManualMetaChange(request({ action, ...(action.startsWith("rename") ? {} : { newName: undefined }) }));
    expect(result.ok).toBe(true);
    expect(state.rows[0]).toMatchObject({ action_type: action });
  });
  it("banco sem a migração (sonda falsa ou ausente): operação desabilitada, nada é registrado nem enviado", async () => {
    state.supported = false;
    expect(await requestManualMetaChange(request())).toMatchObject({ ok: false, code: "extended_unsupported" });
    state.supported = true; state.probeError = true;
    expect(await requestManualMetaChange(request({ action: "pause_ad", newName: undefined }))).toMatchObject({ ok: false, code: "extended_unsupported" });
    expect(state.rows).toHaveLength(0);
    expect(exec).not.toHaveBeenCalled();
  });
  it("ações antigas não dependem da sonda (continuam funcionando mesmo com o banco desatualizado)", async () => {
    state.supported = false; state.probeError = true;
    expect(await requestManualMetaChange(request({ action: "pause_campaign", newName: undefined }))).toMatchObject({ ok: true });
  });
  it("valida o contrato: nome ausente, vazio, grande, em ação que não é renomear e campo desconhecido", async () => {
    for (const over of [{ newName: undefined }, { newName: "   " }, { newName: "x".repeat(401) }, { newName: "linha\nquebrada" }, { action: "pause_ad" }, { dailyBudgetMinor: 100 }, { payload: { status: "ACTIVE" } }, { action: "delete_ad", newName: undefined }, { endpoint: "/me" }]) {
      expect(await requestManualMetaChange(request(over))).toMatchObject({ ok: false });
    }
    expect(state.rows).toHaveLength(0);
  });
  it("somente proprietário/administrador e gate global aberto", async () => {
    ctx.role = "editor";
    expect(await requestManualMetaChange(request())).toMatchObject({ ok: false });
    ctx.role = "owner"; state.gate = false;
    expect(await requestManualMetaChange(request())).toMatchObject({ ok: false, code: "gate_closed" });
    expect(state.rows).toHaveLength(0);
  });
  it("executor desligado: o pedido é rejeitado na fila (nada fica pendente)", async () => {
    exec.mockResolvedValueOnce("disabled");
    expect(await requestManualMetaChange(request())).toMatchObject({ ok: false, code: "executor_disabled" });
    expect(state.moves).toEqual(["authorized", "queued", "rejected"]);
  });
});
