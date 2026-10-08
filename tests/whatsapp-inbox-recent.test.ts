import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { inRecentWhatsAppInbox } from "@/modules/whatsapp/inbox-read";

describe("Inbox de consulta recente", () => {
  const now = Date.parse("2026-10-08T04:00:00.000Z");
  const base = { channel: "qr", last_message_at: "2026-07-01T00:00:00Z", unread_count: 0, favorite: false, archived: false } as const;

  it("mantém conversas recentes e oculta conversas antigas sem importância operacional", () => {
    expect(inRecentWhatsAppInbox(base, now)).toBe(false);
    expect(inRecentWhatsAppInbox({ ...base, last_message_at: "2026-10-07T20:00:00Z" }, now)).toBe(true);
  });

  it("limita até conversas antigas não lidas, favoritas e arquivadas, sem afetar a API oficial", () => {
    expect(inRecentWhatsAppInbox({ ...base, unread_count: 2 }, now)).toBe(false);
    expect(inRecentWhatsAppInbox({ ...base, favorite: true }, now)).toBe(false);
    expect(inRecentWhatsAppInbox({ ...base, archived: true }, now)).toBe(false);
    expect(inRecentWhatsAppInbox({ ...base, channel: "official" }, now)).toBe(true);
  });
});
