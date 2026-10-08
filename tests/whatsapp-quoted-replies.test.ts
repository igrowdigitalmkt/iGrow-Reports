import { describe, expect, it } from "vitest";
import { baileysQuotedMessage, parseEvolutionMessage, parseCloudMessages } from "@/modules/whatsapp/inbox-parse";

describe("WhatsApp quoted replies", () => {
  it("extracts stanzaId and original text without storing media bytes", () => {
    const body = {
      event: "MESSAGES_UPSERT",
      data: {
        key: { id: "MSG_REPLY", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false },
        messageTimestamp: 1791476400,
        message: { extendedTextMessage: {
          text: "Igual a esse",
          contextInfo: { stanzaId: "MSG_ORIGINAL", quotedMessage: { conversation: "Era para segurar a mensagem" } },
        } },
      },
    };
    const msg = parseEvolutionMessage(body);
    expect(msg?.body).toBe("Igual a esse");
    expect(msg?.quote).toEqual({ externalId: "MSG_ORIGINAL", preview: "Era para segurar a mensagem" });
  });

  it("unwraps ephemeral and media replies", () => {
    const quote = baileysQuotedMessage({ ephemeralMessage: { message: {
      imageMessage: { caption: "Nova foto", mimetype: "image/jpeg",
        contextInfo: { stanzaId: "PIC1", quotedMessage: { conversation: "Olha aqui" } },
      },
    } } } as Parameters<typeof baileysQuotedMessage>[0]);
    expect(quote).toEqual({ externalId: "PIC1", preview: "Olha aqui" });
  });

  it("safely discards messages without a valid quoted message id", () => {
    expect(baileysQuotedMessage({ extendedTextMessage: { text: "Oi", contextInfo: { stanzaId: "" } } } as Parameters<typeof baileysQuotedMessage>[0])).toBeNull();
    expect(baileysQuotedMessage({ conversation: "Olá" })).toBeNull();
  });

  it("supports the Cloud API reply context id", () => {
    const data = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: "123456789098" },
        messages: [{ id: "wamid.reply", from: "5511998887777", timestamp: "1791476400", type: "text",
          text: { body: "Obrigado" }, context: { id: "wamid.quoted" } }],
      } }] }],
    };
    expect(parseCloudMessages(data)[0]?.quote).toEqual({ externalId: "wamid.quoted", preview: null });
  });
});
