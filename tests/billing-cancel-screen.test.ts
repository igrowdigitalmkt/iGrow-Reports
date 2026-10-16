import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const context = { role: "owner", agency: { id: "ag-A", name: "Org A" }, user: { id: "user-1" }, supabase: {} };
vi.mock("@/modules/agencies/context", () => ({ requireAgencyContext: async () => context }));
const runtime = { current: null as unknown };
vi.mock("@/modules/billing/server", () => ({ createBillingRuntime: () => runtime.current }));
const runCancel = vi.fn(async () => ({ status: "canceled" as const, message: "ok" }));
vi.mock("@/modules/billing/cancel-flow", () => ({ runCancel: (...args: unknown[]) => runCancel(...(args as [])) }));

import { cancelSubscriptionAction } from "@/modules/billing/actions";
import { SubscriptionScreen } from "@/modules/billing/subscription-screen";
import { deriveContractView, parseBillingSnapshot, type BillingSnapshot } from "@/modules/billing/status-view";
import type { SubscriptionPageData } from "@/modules/billing/subscription-data";

describe("ação de servidor de cancelamento", () => {
  beforeEach(() => { runCancel.mockClear(); context.role = "owner"; runtime.current = { db: {}, asaas: {}, environment: "sandbox" }; });
  it("usa a organização e o usuário da SESSÃO (nada vem do navegador)", async () => {
    await cancelSubscriptionAction();
    expect(runCancel).toHaveBeenCalledWith({ db: {}, asaas: {}, environment: "sandbox" }, { agencyId: "ag-A", userId: "user-1", role: "owner" });
  });
  it("repassa o papel real: quem decide é a lógica do servidor, que recusa não-proprietários", async () => {
    context.role = "admin";
    await cancelSubscriptionAction();
    expect(runCancel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: "admin" }));
  });
  it("sem integração financeira configurada: mensagem clara e nada é chamado", async () => {
    runtime.current = null;
    expect(await cancelSubscriptionAction()).toMatchObject({ status: "error" });
    expect(runCancel).not.toHaveBeenCalled();
  });
});

describe("tela de assinatura: exibição por papel e por estado", () => {
  const snapshot = (sub: Record<string, unknown>, extra: Record<string, unknown> = {}) => parseBillingSnapshot({ role: "owner", current_plan: { name: "Profissional", version: 1, kind: "subscription", access_state: "full" },
    payments: [{ due_date: "2026-10-15", amount_cents: 49900, status: "CONFIRMED", confirmed_at: null, invoice_url: null }],
    subscription: { status: "active", cycle: "yearly", amount_cents: 49900, current_period_end: "2027-10-15T03:00:00Z", next_due_date: "2027-10-15", ...sub }, ...extra }) as BillingSnapshot;
  const render = (billing: BillingSnapshot, role: string) => {
    const data: SubscriptionPageData = { configured: true, canView: true, role, agencyName: "Org A", billing, offers: [], hasBillingData: true };
    return renderToStaticMarkup(createElement(SubscriptionScreen, { data, view: deriveContractView(billing), requestKey: "k" }));
  };
  it("proprietário vê o resumo e o botão de cancelar (ainda sem confirmação aberta)", () => {
    const html = render(snapshot({}), "owner");
    for (const text of ["Sua assinatura", "Profissional", "Anual", "R$", "Próxima renovação", "Acesso pago até", "15 de outubro de 2027", "Cancelar assinatura"]) expect(html).toContain(text);
    expect(html).not.toContain("Confirmar o cancelamento?");
  });
  it("administrador consulta o resumo, mas NÃO vê a opção de cancelar", () => {
    const html = render(snapshot({}), "admin");
    expect(html).toContain("Sua assinatura");
    expect(html).not.toContain("Cancelar assinatura");
  });
  it("depois do pedido de cancelamento: sem botão, com a data de término e a mensagem de que não há renovação", () => {
    const html = render(snapshot({ cancel_requested_at: "2027-01-15T00:00:00Z", cancel_at_period_end: true, remote_cancel_pending: false }), "owner");
    expect(html).toContain("Assinatura cancelada");
    expect(html).toContain("Sem renovação");
    expect(html).not.toContain("Cancelar assinatura");
  });
  it("cancelamento ainda não confirmado pelo Asaas: 'em processamento', sem afirmar que a renovação parou", () => {
    const html = render(snapshot({ cancel_requested_at: "2027-01-15T00:00:00Z", cancel_at_period_end: true, remote_cancel_pending: true }), "owner");
    expect(html).toContain("Cancelamento em processamento");
    expect(html).toContain("ainda não foi interrompida");
  });
  it("em atraso: mostra o prazo de tolerância e o link da cobrança em aberto (só do Asaas)", () => {
    const html = render(snapshot({ status: "past_due", grace_ends_at: "2027-11-23T03:00:00Z" }, { payments: [{ due_date: "2027-11-15", amount_cents: 49900, status: "OVERDUE", confirmed_at: null, invoice_url: "https://sandbox.asaas.com/i/abc" }] }), "owner");
    expect(html).toContain("Pagamento em atraso");
    expect(html).toContain("Em atraso (tolerância de 7 dias)");
    expect(html).toContain("Ver a cobrança em aberto");
    expect(html).toContain("https://sandbox.asaas.com/i/abc");
  });
  it("link de cobrança de outro domínio NÃO é exibido", () => {
    const html = render(snapshot({ status: "past_due" }, { payments: [{ due_date: "2027-11-15", amount_cents: 49900, status: "OVERDUE", confirmed_at: null, invoice_url: "https://evil.example.com/x" }] }), "owner");
    expect(html).not.toContain("evil.example.com");
    expect(html).not.toContain("Ver a cobrança em aberto");
  });
});
