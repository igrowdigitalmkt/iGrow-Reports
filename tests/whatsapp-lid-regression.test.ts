import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isPrivateWhatsAppId, conversationTitle, formatWhatsAppPhone } from "@/modules/whatsapp/inbox-format";
import { parseEvolutionMessage } from "@/modules/whatsapp/inbox-parse";

describe("identificadores privados do WhatsApp", () => {
  it("não transforma o LID em número de telefone nem em nome", () => {
    const lid = "31580961656923@lid";
    expect(isPrivateWhatsAppId(lid)).toBe(true);
    expect(formatWhatsAppPhone(lid)).toBe("Número não compartilhado");
    expect(conversationTitle({ remoteId: lid, title: "31580961656923", isGroup: false })).toBe("Contato do WhatsApp · 6923");
    expect(conversationTitle({ remoteId: lid, title: "Maria", isGroup: false })).toBe("Maria");
  });
  it("mantém nomes reais e número alternativo quando fornecido pela Evolution", () => {
    const m = parseEvolutionMessage({ event: "MESSAGES_UPSERT", data: { key: { id: "abc", remoteJid: "31580961656923@lid", remoteJidAlt: "5586999999999@s.whatsapp.net", fromMe: false }, pushName: "Maria", message: { conversation: "Olá" }, messageTimestamp: 1791420000 }});
    expect(m?.remoteId).toBe("5586999999999");
    expect(m?.title).toBe("Maria");
    const withoutName = parseEvolutionMessage({ event: "MESSAGES_UPSERT", data: { key: { id: "def", remoteJid: "31580961656923@lid", fromMe: false }, pushName: "31580961656923", message: { conversation: "Olá" } }});
    expect(withoutName?.remoteId).toBe("31580961656923@lid");
    expect(withoutName?.title).toBeNull();
  });
});
