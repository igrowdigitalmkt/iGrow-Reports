import { describe, expect, it } from "vitest";
import { normalizeNumber, verifyNumbers } from "@/modules/ai/number-guard";

describe("number guard", () => {
  it("normalizes pt-BR formats", () => {
    expect(normalizeNumber("1.260")).toBe("1260");
    expect(normalizeNumber("1.260,50")).toBe("1260.5");
    expect(normalizeNumber("18,0")).toBe("18");
    expect(normalizeNumber("42")).toBe("42");
  });
  it("accepts a text whose numbers all come from confirmed facts", () => {
    const result = verifyNumbers("Foram 42 contatos, investimento de R$ 1.260 e queda de 18% no custo.", [42, "1260.00", 18]);
    expect(result).toEqual({ ok: true, unverified: [] });
  });
  it("rejects invented or altered numbers", () => {
    const result = verifyNumbers("Foram 45 contatos e R$ 1.260 investidos.", [42, 1260]);
    expect(result).toEqual({ ok: false, unverified: ["45"] });
  });
  it("ignores list markers at the start of a line but not numbers inside the text", () => {
    expect(verifyNumbers("1. Custo de R$ 13,00\n2. Alcance de 128.504", [13, 128504]).ok).toBe(true);
    expect(verifyNumbers("1. Custo de R$ 14,00", [13]).unverified).toEqual(["14"]);
  });
  it("lets the caller allow date parts explicitly", () => {
    expect(verifyNumbers("Semana de 6 a 12/10.", [6, 12, 10]).ok).toBe(true);
    expect(verifyNumbers("Semana de 6 a 12/10.", []).unverified).toEqual(["6", "12", "10"]);
  });
});
