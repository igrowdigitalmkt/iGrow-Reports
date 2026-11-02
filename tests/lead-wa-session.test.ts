import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { LEAD_INSTANCE, cleanIgnoredNumbers, leadInstanceName } from "@/modules/lead-pages/wa-session";

describe("sessão de WhatsApp dos leads", () => {
  it("o nome da instância de captação não se confunde com a da agência", () => {
    const id = "0b9b2c1e-3f6a-4c55-9a39-5d5a1c6e7f10";
    expect(leadInstanceName(id)).toBe(`igrow-lead-${id}`);
    expect(LEAD_INSTANCE.exec(leadInstanceName(id))?.[1]).toBe(id);
    expect(LEAD_INSTANCE.test(`igrow-${id}`)).toBe(false);
    expect(LEAD_INSTANCE.test("igrow-lead-x")).toBe(false);
  });
  it("guarda só telefones válidos, sem repetição", () => {
    expect(cleanIgnoredNumbers(["(86) 99999-9999", "86999999999", "abc", "", "+55 86 98888-7777"])).toEqual(["5586999999999", "5586988887777"]);
  });
});
