import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { AudienceRow, ClientAccountBilling, ClientAudienceBreakdowns } from "@/modules/meta/server";
import { audienceForPdf, balancesForPdf } from "@/modules/reports/pdf/extras-map";

const row = (label: string, reach: number): AudienceRow => ({ key: label, label, reach, impressions: reach * 2, clicks: 0, spend: 0, results: 0 });
const breakdowns = (overrides: Partial<ClientAudienceBreakdowns> = {}): ClientAudienceBreakdowns => ({
  platforms: [row("Instagram", 86000), row("WhatsApp", 30600), row("Facebook", 16300)],
  gender: [row("Mulheres", 70700), row("Homens", 57700), row("Não informado", 730)],
  age: [row("25-34", 29900), row("35-44", 28900)], region: [row("Piauí", 113900), row("Maranhão", 13800)],
  country: [row("BR", 130000)], currency: "BRL", ...overrides,
});

describe("público do PDF", () => {
  it("usa o alcance, ordena as fatias e formata em mil", () => {
    const result = audienceForPdf(breakdowns());
    expect(result?.indicator).toBe("Alcance");
    expect(result?.groups.map(group => group.title)).toEqual(["Plataformas", "Gênero", "Idade", "Região"]);
    expect(result?.groups[0]?.items.map(item => item.label)).toEqual(["Instagram", "WhatsApp", "Facebook"]);
    expect(result?.groups[0]?.items[0]?.display).toBe("86 mil");
    expect(result?.groups[0]?.total).toBe("132,9 mil");
  });

  it("agrupa a cauda em Outros e ignora linhas sem alcance", () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`Região ${i}`, 1000 * (9 - i)));
    const result = audienceForPdf(breakdowns({ region: [...many, row("Sem alcance", 0)] }));
    const region = result?.groups.find(group => group.title === "Região");
    expect(region?.items).toHaveLength(7);
    expect(region?.items.at(-1)?.label).toBe("Outros");
    expect(region?.items.at(-1)?.value).toBe(3000 + 2000 + 1000);
  });

  it("devolve nada quando a Meta não trouxe público", () => {
    expect(audienceForPdf(breakdowns({ platforms: [], gender: [], age: [], region: [] }))).toBeUndefined();
  });
});

const account = (overrides: Partial<ClientAccountBilling> = {}): ClientAccountBilling => ({
  accountId: "a", name: "Ronaldo Moreira", currency: "BRL", delivering: true, statusLabel: "Ativa", prepaid: false, fundingLabel: "VISA *7129",
  amountSpent: 28736.37, spendCap: null, balanceDue: 940.7, availableBalance: null, ...overrides,
});

describe("saldo e pagamentos do PDF", () => {
  it("conta pós-paga mostra o valor a pagar e o gasto desde a criação sem limite", () => {
    const [row] = balancesForPdf([account()]) ?? [];
    expect(row?.status).toBe("Ativa · Pós-pago · VISA *7129");
    expect(row?.cells[0]).toEqual({ label: "A pagar", value: "R$ 940,70" });
    expect(row?.cells[1]).toEqual({ label: "Limite de gastos", value: "Sem limite", sub: "R$ 28.736,37 gastos desde a criação" });
  });

  it("conta pré-paga mostra o saldo e o que resta do limite", () => {
    const [row] = balancesForPdf([account({ name: "RM", prepaid: true, fundingLabel: null, availableBalance: 456.94, spendCap: 11937.99, amountSpent: 11536.48 })]) ?? [];
    expect(row?.status).toBe("Ativa · Pré-pago");
    expect(row?.cells[0]).toEqual({ label: "Saldo pré-pago", value: "R$ 456,94" });
    expect(row?.cells[1]).toEqual({ label: "Limite de gastos", value: "R$ 401,51 restantes", sub: "de R$ 11.937,99" });
  });

  it("valor que a Meta não informa fica indisponível, nunca zero", () => {
    const [row] = balancesForPdf([account({ balanceDue: null })]) ?? [];
    expect(row?.cells[0]?.value).toBe("Indisponível");
    expect(balancesForPdf([])).toBeUndefined();
  });
});
