import { describe, expect, it } from "vitest";
import { parseFundingAmount } from "@/modules/meta/billing";

describe("parseFundingAmount", () => {
  it("lê o saldo pré-pago no formato brasileiro e no americano", () => {
    expect(parseFundingAmount("Saldo disponível (R$1.234,56 BRL)")).toBe(1234.56);
    expect(parseFundingAmount("Available balance (R$1,234.56 BRL)")).toBe(1234.56);
    expect(parseFundingAmount("Saldo disponível (R$ 80,00 BRL)")).toBe(80);
  });
  it("não inventa saldo quando o texto não traz valor", () => {
    expect(parseFundingAmount("Visa *1234")).toBeNull();
    expect(parseFundingAmount(null)).toBeNull();
  });
});
