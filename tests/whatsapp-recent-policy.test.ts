import { describe, expect, it } from "vitest";
import { isRecentQrMessage } from "@/modules/whatsapp/recent-policy";

describe("Proteção contra importação histórica via upsert", () => {
  const now = Date.parse("2026-10-08T04:00:00Z");
  it("aceita mensagem recente", () => {
    expect(isRecentQrMessage("2026-10-08T03:00:00Z", now)).toBe(true);
  });
  it("recusa mensagens antigas do replay e datas inválidas", () => {
    expect(isRecentQrMessage("2026-01-01T00:00:00Z", now)).toBe(false);
    expect(isRecentQrMessage("invalid", now)).toBe(false);
    expect(isRecentQrMessage("2026-10-12T03:00:00Z", now)).toBe(false);
  });
});
