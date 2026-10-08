import { describe, expect, it } from "vitest";
import { canPinMessages, canForwardInboxMessage } from "@/modules/whatsapp/message-actions";

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
});
