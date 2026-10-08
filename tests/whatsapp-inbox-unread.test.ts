import { describe, expect, it } from "vitest";
import { optimisticReadApplies, optimisticReadSnapshot } from "@/modules/whatsapp/inbox-unread";

describe("WhatsApp inbox unread badges", () => {
  const oldMessage = {
    unread: 2,
    lastInboundAt: "2026-10-08T02:11:12Z",
    lastAt: "2026-10-08T02:11:12Z",
    preview: "Mensagem anterior",
  };

  it("hides the existing unread badge immediately after opening a chat", () => {
    const mark = optimisticReadSnapshot(oldMessage, 1000);
    expect(optimisticReadApplies(oldMessage, mark, 1001)).toBe(true);
  });

  it("shows a new incoming message on the same chat without a full page refresh", () => {
    const mark = optimisticReadSnapshot(oldMessage, 1000);
    const nextMessage = {
      ...oldMessage,
      unread: 1,
      lastInboundAt: "2026-10-08T02:15:20Z",
      lastAt: "2026-10-08T02:15:20Z",
      preview: "Mensagem nova",
    };
    expect(optimisticReadApplies(nextMessage, mark, 3000)).toBe(false);
  });

  it("does not hide messages with the same timestamp but a different preview", () => {
    const mark = optimisticReadSnapshot(oldMessage, 1000);
    expect(optimisticReadApplies({ ...oldMessage, preview: "Outra mensagem" }, mark, 3000)).toBe(false);
  });

  it("expires the local override if the server never confirms the read", () => {
    const mark = optimisticReadSnapshot(oldMessage, 1000);
    expect(optimisticReadApplies(oldMessage, mark, 16_001)).toBe(false);
    expect(optimisticReadApplies({ ...oldMessage, unread: 0 }, mark, 1001)).toBe(false);
  });
});
