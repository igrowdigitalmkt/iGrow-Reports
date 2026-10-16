import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AsaasError, type AsaasApi } from "@/modules/billing/asaas-client";
import type { BillingDb } from "@/modules/billing/db";
import type { BillingDeps } from "@/modules/billing/event-processor";
import { reconcileBilling } from "@/modules/billing/reconcile";

type Handler = (args: Record<string, unknown>) => unknown;
function fakeDb(handlers: Record<string, Handler>) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db: BillingDb = { async rpc(name, args = {}) { calls.push({ name, args }); const handler = handlers[name]; if (!handler) return { data: null, error: { code: "42883", message: "x" } }; return { data: handler(args), error: null }; } };
  return { db, of: (name: string) => calls.filter((call) => call.name === name) };
}
const deps = (db: BillingDb, asaas: Partial<AsaasApi>): BillingDeps => ({ db, asaas: asaas as AsaasApi, environment: "sandbox", now: () => new Date("2027-01-15T12:00:00Z") });
const work = (n: number) => ({ reconcile: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, environment: "sandbox", asaas_subscription_id: `sub_00000${i}` })), remote_cancel: [], intents: [] });
const sub = { id: "sub_000000", customer: "cus_123456", value: 49.9, cycle: "MONTHLY", status: "ACTIVE", billingType: "CREDIT_CARD" };

describe("reconciliação de assinaturas: ciclo de vida", () => {
  it("assinatura que já não existe no Asaas (404): registrada como removida e dada como conferida, sem listar cobranças (não trava a fila)", async () => {
    const f = fakeDb({ billing_reconcile_work: () => work(1), billing_apply_subscription: () => "cancel_recorded", billing_mark_reconciled: () => null });
    const listSubscriptionPayments = vi.fn();
    const summary = await reconcileBilling(deps(f.db, { getSubscription: vi.fn(async () => { throw new AsaasError("x", 404, null, false, false, "t"); }), listSubscriptionPayments }));
    expect(summary).toMatchObject({ checked: 1, failed: 0 });
    expect(f.of("billing_apply_subscription")[0].args.p_snapshot).toMatchObject({ id: "sub_000000", deleted: true });
    expect(f.of("billing_mark_reconciled")).toHaveLength(1);
    expect(listSubscriptionPayments).not.toHaveBeenCalled();
  });
  it("falha temporária do Asaas: conta como falha, NÃO marca como conferida (a próxima tentativa vem do carimbo de tentativa do banco) e as demais seguem", async () => {
    const f = fakeDb({ billing_reconcile_work: () => work(3), billing_apply_subscription: () => "noop", billing_apply_payment: () => "noop_duplicate", billing_mark_reconciled: () => null });
    const getSubscription = vi.fn().mockRejectedValueOnce(new AsaasError("x", 503, null, false, true, "t")).mockResolvedValue(sub);
    const summary = await reconcileBilling(deps(f.db, { getSubscription, listSubscriptionPayments: vi.fn(async () => []) }));
    expect(summary).toMatchObject({ checked: 2, failed: 1 });
    expect(f.of("billing_mark_reconciled")).toHaveLength(2);
  });
  it("renovação e regularização por reconciliação (sem webhook): cobranças lidas na API e aplicadas em ordem de vencimento", async () => {
    const f = fakeDb({ billing_reconcile_work: () => work(1), billing_apply_subscription: () => "noop", billing_apply_payment: () => "activated", billing_mark_reconciled: () => null });
    const payments = [
      { id: "pay_000002", subscription: "sub_000000", customer: "cus_123456", value: 49.9, dueDate: "2026-12-15", status: "CONFIRMED", billingType: "CREDIT_CARD" },
      { id: "pay_000001", subscription: "sub_000000", customer: "cus_123456", value: 49.9, dueDate: "2026-11-15", status: "OVERDUE", billingType: "CREDIT_CARD" },
    ];
    await reconcileBilling(deps(f.db, { getSubscription: vi.fn(async () => sub), listSubscriptionPayments: vi.fn(async () => payments) }));
    expect(f.of("billing_apply_payment").map((call) => (call.args.p_snapshot as { id: string }).id)).toEqual(["pay_000001", "pay_000002"]);
  });
  it("pede ao banco só o ambiente configurado e respeita o tempo máximo", async () => {
    const f = fakeDb({ billing_reconcile_work: () => work(4), billing_apply_subscription: () => "noop", billing_mark_reconciled: () => null });
    const summary = await reconcileBilling(deps(f.db, { getSubscription: vi.fn(async () => sub), listSubscriptionPayments: vi.fn(async () => []) }), { limit: 15, deadlineMs: Date.now() - 1 });
    expect(f.of("billing_reconcile_work")[0].args).toEqual({ p_limit: 15, p_environment: "sandbox" });
    expect(summary.checked).toBe(0);
  });
});
