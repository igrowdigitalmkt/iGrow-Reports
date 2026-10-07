import { describe, expect, it } from "vitest";
import { expiryFromDebugToken, tokenExpiry } from "@/modules/whatsapp/token-expiry";

describe("token expiry", () => {
  it("reads the expiry from debug_token and treats 0 as permanent", () => {
    expect(expiryFromDebugToken({ data: { expires_at: 1_800_000_000 } })).toBe(new Date(1_800_000_000_000).toISOString());
    expect(expiryFromDebugToken({ data: { expires_at: 0 } })).toBeNull();
    expect(expiryFromDebugToken({})).toBeNull();
    expect(expiryFromDebugToken(null)).toBeNull();
  });

  it("classifies the time left", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(tokenExpiry(null, now)).toBeNull();
    expect(tokenExpiry("2026-12-01T12:00:00Z", now)?.level).toBe("ok");
    expect(tokenExpiry("2026-10-15T12:00:00Z", now)).toMatchObject({ level: "soon", daysLeft: 8 });
    expect(tokenExpiry("2026-10-07T11:00:00Z", now)).toMatchObject({ level: "expired", daysLeft: 0 });
    expect(tokenExpiry("invalid", now)).toBeNull();
  });
});
