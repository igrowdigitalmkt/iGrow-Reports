import { describe, expect, it } from "vitest";
import { isReportedVital, vitalsRoute } from "@/lib/web-vitals";

describe("medição de velocidade", () => {
  it("troca ids e códigos privados do endereço", () => {
    expect(vitalsRoute("/clientes/0b9b2c1e-3f6a-4c55-9a39-5d5a1c6e7f10/leads")).toBe("/clientes/:id/leads");
    expect(vitalsRoute("/leads/dxK8Cefjrxu_FKhV4PWevMFM")).toBe("/leads/:id");
    expect(vitalsRoute("/clientes?pagina=2")).toBe("/clientes");
    expect(vitalsRoute("/relatorios")).toBe("/relatorios");
    expect(vitalsRoute("")).toBe("/");
  });
  it("só aceita as medidas conhecidas", () => {
    expect(isReportedVital("LCP")).toBe(true);
    expect(isReportedVital("INP")).toBe(true);
    expect(isReportedVital("FID")).toBe(false);
    expect(isReportedVital(5)).toBe(false);
  });
});
