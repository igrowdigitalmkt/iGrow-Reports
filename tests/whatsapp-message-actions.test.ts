import { describe, expect, it } from "vitest";
import { canPinMessages, canForwardInboxMessage, canDeleteOwnMessage, canRevokeForEveryone, WA_REVOKE_MAX_AGE_MS } from "@/modules/whatsapp/message-actions";

describe("WhatsApp message actions", () => {
  it("allows at most 3 distinct pinned messages, including a repeated pin", () => {
    expect(canPinMessages(["a", "b"], ["b", "c"])).toBe(true);
    expect(canPinMessages(["a", "b", "c"], ["d"])).toBe(false);
    expect(canPinMessages(["a", "a"], ["b", "c"])).toBe(true);
    expect(canPinMessages([], ["a", "b", "c", "d"])).toBe(false);
  });
  it("forwards text or eligible media, but never a fabricated empty message", () => {
    expect(canForwardInboxMessage({ kind: "text", body: "Olá" })).toBe(true);
    expect(canForwardInboxMessage({ kind: "text", body: "  " })).toBe(false);
    for (const kind of ["image","video","audio","document"])
      expect(canForwardInboxMessage({ kind })).toBe(true);
    for (const kind of ["sticker","reaction","other"])
      expect(canForwardInboxMessage({ kind })).toBe(false);
  });
  it("never deletes incoming or previously revoked messages", () => {
    expect(canDeleteOwnMessage({ direction: "in" })).toBe(false);
    expect(canDeleteOwnMessage({ direction: "out" })).toBe(true);
    expect(canDeleteOwnMessage({ direction: "out", revoked: true })).toBe(false);
  });
  it("revokes only real recent outgoing QR messages (not official or local keys)", () => {
    const now = Date.parse("2026-10-08T16:00:00Z");
    const base = { channel: "qr" as const, direction: "out" as const, externalId: "3EB0ABCDEF", sentAt: new Date(now - 5 * 60_000).toISOString() };
    expect(canRevokeForEveryone(base, now)).toBe(true);
    expect(canRevokeForEveryone({ ...base, direction: "in" }, now)).toBe(false);
    expect(canRevokeForEveryone({ ...base, revoked: true }, now)).toBe(false);
    expect(canRevokeForEveryone({ ...base, channel: "official" }, now)).toBe(false);
    expect(canRevokeForEveryone({ ...base, externalId: "igrow-temp" }, now)).toBe(false);
    expect(canRevokeForEveryone({ ...base, sentAt: new Date(now - WA_REVOKE_MAX_AGE_MS - 1).toISOString() }, now)).toBe(false);
    expect(canRevokeForEveryone({ ...base, sentAt: new Date(now + 60_000).toISOString() }, now)).toBe(false);
  });
});
