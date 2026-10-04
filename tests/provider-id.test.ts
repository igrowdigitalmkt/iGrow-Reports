import { describe, expect, it } from "vitest";
import { isProviderId, requireProviderId } from "@/modules/integrations/provider-id";

describe("provider identifiers", () => {
  it("accepts the supported integration catalog", () => {
    expect(["meta", "google", "tiktok", "linkedin", "youtube", "whatsapp", "qstash"].every(isProviderId)).toBe(true);
  });
  it("rejects unknown providers", () => {
    expect(isProviderId("facebook")).toBe(false);
    expect(() => requireProviderId("facebook")).toThrow("Provedor não suportado");
  });
});
