import { describe, expect, it } from "vitest";
import { isOptOutText, parseIncomingMessage, parseMessageReceipt } from "@/modules/whatsapp-qr/opt-out";

const upsert = (key: Record<string, unknown>, message: Record<string, unknown>) => ({ event: "messages.upsert", instance: "igrow-a", data: { key, message } });

describe("descadastro por resposta", () => {
  it("reconhece PARAR e variações, sem confundir com conversa normal", () => {
    for (const text of ["PARAR", "parar", " Parar! ", "Sair", "cancelar.", "não quero mais receber", "STOP"]) expect(isOptOutText(text)).toBe(true);
    for (const text of ["Vou parar a campanha?", "Obrigado", "parar de investir", ""]) expect(isOptOutText(text)).toBe(false);
  });

  it("lê o telefone de quem respondeu, inclusive em contas com identificador interno", () => {
    expect(parseIncomingMessage(upsert({ remoteJid: "5586994037823@s.whatsapp.net", fromMe: false }, { conversation: "PARAR" })))
      .toEqual({ instance: "igrow-a", phone: "+5586994037823", text: "PARAR" });
    expect(parseIncomingMessage(upsert({ remoteJid: "1234567890@lid", remoteJidAlt: "5586994037823@s.whatsapp.net" }, { extendedTextMessage: { text: "Sair" } }))?.phone)
      .toBe("+5586994037823");
  });

  it("ignora mensagens enviadas pelo próprio número, grupos e outros eventos", () => {
    expect(parseIncomingMessage(upsert({ remoteJid: "5586994037823@s.whatsapp.net", fromMe: true }, { conversation: "PARAR" }))).toBeNull();
    expect(parseIncomingMessage(upsert({ remoteJid: "1203@g.us" }, { conversation: "PARAR" }))).toBeNull();
    expect(parseIncomingMessage({ event: "connection.update", instance: "igrow-a", data: {} })).toBeNull();
    expect(parseIncomingMessage(upsert({ remoteJid: "1234567890@lid" }, { conversation: "PARAR" }))).toBeNull();
  });
});

describe("confirmações de entrega e leitura", () => {
  const update = (data: Record<string, unknown>) => ({ event: "messages.update", instance: "igrow-a", data });
  it("traduz entregue e lida e ignora os demais estados", () => {
    expect(parseMessageReceipt(update({ keyId: "3EB0", fromMe: true, status: "DELIVERY_ACK" }))).toEqual({ instance: "igrow-a", messageId: "3EB0", status: "delivered" });
    expect(parseMessageReceipt(update({ keyId: "3EB0", fromMe: true, status: "READ" }))?.status).toBe("read");
    expect(parseMessageReceipt(update({ keyId: "3EB0", fromMe: true, status: "PLAYED" }))?.status).toBe("read");
    expect(parseMessageReceipt(update({ keyId: "3EB0", fromMe: true, status: "SERVER_ACK" }))).toBeNull();
    expect(parseMessageReceipt(update({ keyId: "3EB0", fromMe: false, status: "READ" }))).toBeNull();
    expect(parseMessageReceipt({ event: "messages.upsert", instance: "igrow-a", data: {} })).toBeNull();
  });
});
