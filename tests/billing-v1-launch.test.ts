import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fechamento da V1: escolha de plano sem confusão e Google ao vivo sob a mesma trava das demais operações pagas.
const mocks = vi.hoisted(() => ({ access: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/billing/actions", () => ({ startCheckoutAction: vi.fn() }));
vi.mock("@/modules/billing/access", () => ({ getAgencyBillingAccess: mocks.access }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: mocks.service }));
import { CheckoutForm } from "@/modules/billing/checkout-form";
import { BillingRestrictedError } from "@/modules/billing/guard";
import { loadGoogleSections } from "@/modules/google-ads/provider";

const offer = (id: string, name: string, monthly: number, recommended: boolean) => ({
  plan_version_id: id, plan_id: id, key: id, name, description: null, version: 1, recommended, price_monthly_cents: monthly, price_yearly_cents: monthly * 10, entitlements: [], sort_order: 100,
});
const render = (offers: ReturnType<typeof offer>[]) => renderToStaticMarkup(createElement(CheckoutForm, { offers: offers as never, requestKey: "chave-de-teste-0001", needsBillingData: true, canContract: true }));
const checkedPlans = (html: string) => (html.match(/name="plan"[^>]*checked/g) ?? []).length;

describe("escolha do plano na contratação", () => {
  const a = offer("a", "Plano A", 7990, true), b = offer("b", "Plano B", 4990, true), c = offer("c", "Plano C", 9990, false);
  it("dois planos recomendados: nenhum vem selecionado, sem selo, valores só depois da escolha e botão desabilitado", () => {
    const html = render([a, b]);
    expect(checkedPlans(html)).toBe(0);
    expect(html).not.toContain("Recomendado");
    expect(html).toContain("Escolha um plano acima");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>/);
  });
  it("vários planos e nenhum recomendado: também exige escolha", () => {
    expect(checkedPlans(render([c, { ...b, recommended: false }]))).toBe(0);
  });
  it("exatamente um recomendado entre vários: vem selecionado e com selo", () => {
    const html = render([{ ...a, recommended: false }, b, c]);
    expect(checkedPlans(html)).toBe(1);
    expect(html).toContain("Recomendado");
    expect(html).toContain("R$");
  });
  it("catálogo da V1 (Start, Pro recomendado, Scale): Pro vem selecionado e destacado, e o Personalizado aparece sem checkout", () => {
    const start = offer("s", "Start", 7990, false), pro = offer("p", "Pro", 14990, true), scale = offer("c", "Scale", 27990, false);
    const html = render([start, pro, scale]);
    expect(checkedPlans(html)).toBe(1);
    expect(html.match(/Recomendado/g)?.length).toBe(1);
    expect(html.indexOf("Pro")).toBeLessThan(html.indexOf("Recomendado"));
    expect(html).toContain("Personalizado");
    expect(html).toContain("mediante orçamento");
    expect(html).not.toMatch(/name="plan"[^>]*value="personalizado"/);
  });
  it("plano único: selecionado, sem selo", () => {
    const html = render([a]);
    expect(checkedPlans(html)).toBe(1);
    expect(html).not.toContain("Recomendado");
  });
});

describe("Google Ads ao vivo respeita a restrição financeira", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.service.mockReturnValue({}); });
  const input = { service: {} as never, agencyId: "ag", clientId: "c", dateFrom: "2026-09-01", dateTo: "2026-09-30" };
  it("restrito ou não confirmável: não consulta nem as contas vinculadas", async () => {
    for (const state of ["restricted", "unknown"]) {
      mocks.access.mockResolvedValue(state);
      await expect(loadGoogleSections(input)).rejects.toBeInstanceOf(BillingRestrictedError);
    }
  });
  it("liberado: segue o caminho normal (sem contas vinculadas devolve vazio)", async () => {
    mocks.access.mockResolvedValue("allowed");
    const service = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: [] }) }) }) }) }) };
    expect(await loadGoogleSections({ ...input, service: service as never })).toEqual({ sections: [], failures: [] });
  });
});

describe("WhatsApp nos planos: QR incluído e fora do limite de números oficiais", () => {
  it("cada plano mostra a conexão por QR Code como incluída e separada", () => {
    const html = renderToStaticMarkup(createElement(CheckoutForm, { offers: [offer("s", "Start", 7990, false), offer("p", "Pro", 14990, true)] as never, requestKey: "chave-de-teste-0001", needsBillingData: true, canContract: true }));
    expect(html.match(/WhatsApp por QR Code: 1 conexão incluída/g)?.length).toBe(2);
    expect(html).toContain("não conta nos números oficiais");
  });
});
