import { describe, expect, it } from "vitest";
import { describeBaileysContent, parseCloudMessages, parseEvolutionMessage } from "@/modules/whatsapp/inbox-parse";

const upsert = (key: Record<string, unknown>, message: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ event: "messages.upsert", instance: "igrow-a", data: { key: { id: "3EB0A1", ...key }, message, pushName: "Maria Souza", messageTimestamp: 1791370000, ...extra } });

describe("parseEvolutionMessage", () => {
  it("mensagem recebida numa conversa privada", () => {
    expect(parseEvolutionMessage(upsert({ remoteJid: "558699990000@s.whatsapp.net", fromMe: false }, { conversation: "Oi, recebi" }))).toEqual({
      remoteId: "558699990000", isGroup: false, title: "Maria Souza", author: null, externalId: "3EB0A1", direction: "in",
      kind: "text", body: "Oi, recebi", mediaName: null, mediaMime: null, sentAt: new Date(1791370000 * 1000).toISOString(),
    });
  });

  it("mensagem enviada pelo celular entra como enviada e não renomeia a conversa", () => {
    const message = parseEvolutionMessage(upsert({ remoteJid: "558699990000@s.whatsapp.net", fromMe: true }, { extendedTextMessage: { text: "Bom dia!" } }));
    expect(message).toMatchObject({ direction: "out", title: null, body: "Bom dia!" });
  });

  it("conta nova (@lid) usa o telefone do campo alternativo", () => {
    expect(parseEvolutionMessage(upsert({ remoteJid: "123456@lid", remoteJidAlt: "5586988887777@s.whatsapp.net" }, { conversation: "x" }))?.remoteId).toBe("5586988887777");
  });

  it("grupo guarda o autor e não usa o nome dele como título", () => {
    const message = parseEvolutionMessage(upsert({ remoteJid: "120363000000000001@g.us", participant: "558611112222@s.whatsapp.net" }, { imageMessage: { caption: "Foto do evento", mimetype: "image/jpeg" } }));
    expect(message).toMatchObject({ isGroup: true, remoteId: "120363000000000001@g.us", title: null, author: "Maria Souza", kind: "image", body: "Foto do evento" });
  });

  it("envio feito pela plataforma (send.message) entra como enviado", () => {
    const message = parseEvolutionMessage({ ...upsert({ remoteJid: "558699990000@s.whatsapp.net" }, { conversation: "Relatório" }), event: "send.message" });
    expect(message?.direction).toBe("out");
  });

  it("ignora status, canais e mensagens técnicas", () => {
    expect(parseEvolutionMessage(upsert({ remoteJid: "status@broadcast" }, { conversation: "x" }))).toBeNull();
    expect(parseEvolutionMessage(upsert({ remoteJid: "1@newsletter" }, { conversation: "x" }))).toBeNull();
    expect(parseEvolutionMessage(upsert({ remoteJid: "558699990000@s.whatsapp.net" }, { protocolMessage: { type: 0 } }))).toBeNull();
    expect(parseEvolutionMessage({ event: "messages.update", data: {} })).toBeNull();
  });
});

describe("describeBaileysContent", () => {
  it("documento, áudio, figurinha e mensagens temporárias", () => {
    expect(describeBaileysContent({ documentMessage: { fileName: "Relatorio.pdf", mimetype: "application/pdf" } })).toMatchObject({ kind: "document", mediaName: "Relatorio.pdf" });
    expect(describeBaileysContent({ audioMessage: { ptt: true, mimetype: "audio/ogg" } })?.kind).toBe("audio");
    expect(describeBaileysContent({ stickerMessage: {} })?.kind).toBe("sticker");
    expect(describeBaileysContent({ ephemeralMessage: { message: { conversation: "some" } } })).toMatchObject({ kind: "text", body: "some" });
    expect(describeBaileysContent({ reactionMessage: { text: "" } })).toBeNull();
  });
});

describe("parseCloudMessages", () => {
  const payload = {
    entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "991218314063731" },
      contacts: [{ wa_id: "558699990000", profile: { name: "Maria" } }],
      messages: [
        { id: "wamid.IN1", from: "558699990000", timestamp: "1791370000", type: "text", text: { body: "Pode me explicar o CPC?" } },
        { id: "wamid.IN2", from: "558699990000", timestamp: "1791370060", type: "document", document: { filename: "contrato.pdf", mime_type: "application/pdf" } },
        { id: "wamid.SYS", from: "558699990000", timestamp: "1791370060", type: "system" },
      ],
      message_echoes: [{ id: "wamid.OUT1", from: "558694037823", to: "558699990000", timestamp: "1791370100", type: "text", text: { body: "Claro!" } }],
    } }] }],
  };

  it("recebidas e ecos do app (coexistência) com o número oficial", () => {
    const messages = parseCloudMessages(payload);
    expect(messages.map(message => [message.externalId, message.direction, message.kind, message.remoteId, message.title])).toEqual([
      ["wamid.IN1", "in", "text", "558699990000", "Maria"],
      ["wamid.IN2", "in", "document", "558699990000", "Maria"],
      ["wamid.OUT1", "out", "text", "558699990000", null],
    ]);
    expect(messages.every(message => message.phoneNumberId === "991218314063731")).toBe(true);
  });

  it("aviso só de status não vira mensagem", () => {
    expect(parseCloudMessages({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "991218314063731" }, statuses: [{ id: "x", status: "read" }] } }] }] })).toEqual([]);
  });
});
