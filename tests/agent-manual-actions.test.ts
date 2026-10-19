import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ctx = vi.hoisted(() => ({ role: "owner" as string }));
vi.mock("@/modules/agencies/context", () => ({
  requireAgencyContext: async () => ({ role: ctx.role, user: { id: "u1" }, agency: { id: "ag" } }),
}));
const state = vi.hoisted(() => ({ gate: true as boolean, busy: false, duplicate: false, rows: [] as Record<string, unknown>[], moves: [] as string[] }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    rpc: async () => ({ data: state.gate, error: null }),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      for (const m of ["select", "eq", "is"]) q[m] = () => q;
      q.maybeSingle = () => {
        if (patch) {
          if (patch.status === "queued" && state.busy) return Promise.resolve({ data: null, error: { code: "23505" } });
          state.moves.push(String(patch.status));
          return Promise.resolve({ data: { id: "x" }, error: null });
        }
        return Promise.resolve({ data: table === "client_ad_accounts" ? { active: true } : { id: "x" }, error: null });
      };
      q.update = (p: Record<string, unknown>) => { patch = p; return q; };
      q.insert = (row: Record<string, unknown>) => {
        if (state.duplicate) return Promise.resolve({ error: { code: "23505" } });
        state.rows.push(row);
        return Promise.resolve({ error: null });
      };
      return q;
    },
  }),
}));

const exec = vi.hoisted(() => vi.fn(async () => "verified"));
vi.mock("@/modules/agent-executor/scheduler", () => ({ executeQueuedJobNow: exec }));

import { requestManualMetaChange } from "@/modules/agent-executor/manual-actions";

const input = (over: Record<string, unknown> = {}) => ({
  requestId: "10000000-0000-4000-8000-000000000001", clientId: "20000000-0000-4000-8000-000000000002",
  adAccountId: "30000000-0000-4000-8000-000000000003", action: "pause_campaign", targetId: "555", ...over,
});
beforeEach(() => {
  exec.mockClear();
  Object.assign(state, { gate: true, busy: false, duplicate: false, rows: [], moves: [] });
  ctx.role = "owner";
});

describe("alteracao manual", () => {
  it("registra job de origem manual, sem delegacao nem aprovacao de IA, e o enfileira", async () => {
    const r = await requestManualMetaChange(input());
    expect(r.ok).toBe(true);
    expect(state.rows[0]).toMatchObject({ execution_origin: "manual", requested_by: "u1", delegation_id: null, action_type: "pause_campaign", agency_id: "ag" });
    expect(state.rows[0]).not.toHaveProperty("approved_by");
    expect(state.moves).toEqual(["authorized", "queued"]);
    expect(exec).toHaveBeenCalledWith(expect.anything(), { agencyId: "ag", jobId: expect.any(String) });
  });
  it("executor desligado: rejeita o pedido na fila e nada fica pendente", async () => {
    exec.mockResolvedValueOnce("disabled");
    const r = await requestManualMetaChange(input());
    expect(r).toMatchObject({ ok: false });
    expect(state.moves).toEqual(["authorized", "queued", "rejected"]);
  });
  it("somente proprietario ou administrador", async () => {
    ctx.role = "editor";
    expect(await requestManualMetaChange(input())).toMatchObject({ ok: false });
    expect(state.rows).toHaveLength(0);
  });
  it("respeita o gate global desligado e valida os campos", async () => {
    state.gate = false;
    expect(await requestManualMetaChange(input())).toMatchObject({ ok: false });
    state.gate = true;
    expect(await requestManualMetaChange(input({ action: "set_campaign_daily_budget" }))).toMatchObject({ ok: false });
    expect(await requestManualMetaChange(input({ dailyBudgetMinor: 100 }))).toMatchObject({ ok: false });
    expect(await requestManualMetaChange(input({ agencyId: "outra" }))).toMatchObject({ ok: false });
    expect(state.rows).toHaveLength(0);
  });
  it("conta ocupada rejeita o job (nada fica autorizado) e duplo clique nao duplica", async () => {
    state.busy = true;
    expect(await requestManualMetaChange(input())).toMatchObject({ ok: false });
    expect(state.moves).toEqual(["authorized", "rejected"]);
    expect(exec).not.toHaveBeenCalled();
    state.busy = false;
    state.duplicate = true;
    expect(await requestManualMetaChange(input())).toMatchObject({ ok: false, message: "Esta solicitacao ja foi registrada." });
  });
});
