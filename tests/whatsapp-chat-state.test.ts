import { describe, expect, it } from "vitest";
import { parseQrChatStates } from "@/modules/whatsapp-qr/chat-state";

describe("estado das conversas do WhatsApp QR", () => {
  it("normaliza conversa privada e preserva grupos", () => {
    expect(parseQrChatStates({
      event: "chats.update",
      data: [
        { remoteJid: "5586994037823@s.whatsapp.net", archived: true, unreadMessages: 0 },
        { remoteJid: "120363999@g.us", archived: false, unreadCount: 12 },
      ],
    })).toEqual([
      { remoteId: "5586994037823", archived: true, unread: 0 },
      { remoteId: "120363999@g.us", archived: false, unread: 12 },
    ]);
  });

  it("aceita carga inicial e campos parciais sem inventar estado", () => {
    expect(parseQrChatStates({
      event: "CHATS_SET",
      data: [
        { remoteJid: "5586994037823:5@s.whatsapp.net", archived: false },
        { remoteJid: "42@lid", unreadMessages: 3 },
        { remoteJid: "sem-estado@s.whatsapp.net" },
      ],
    })).toEqual([
      { remoteId: "5586994037823", archived: false },
      { remoteId: "42@lid", unread: 3 },
    ]);
  });

  it("ignora outros eventos, ids inválidos e contadores inválidos", () => {
    expect(parseQrChatStates({ event: "messages.update", data: { remoteJid: "5586994037823@s.whatsapp.net", archived: true } })).toEqual([]);
    expect(parseQrChatStates({ event: "chats.update", data: [{ remoteJid: "x", archived: true }] })).toEqual([]);
    expect(parseQrChatStates({ event: "chats.update", data: [{ remoteJid: "120@g.us", unreadMessages: -2 }] })).toEqual([]);
  });
});
