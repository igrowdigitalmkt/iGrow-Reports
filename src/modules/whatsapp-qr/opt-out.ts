// Replies that stop the automatic reports. Compared without accents, case or punctuation.
const STOP_WORDS = new Set(["PARAR", "PARE", "SAIR", "CANCELAR", "DESCADASTRAR", "STOP", "NAO QUERO MAIS RECEBER"]);

export function isOptOutText(text: string) {
  const normalized = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  return STOP_WORDS.has(normalized);
}

export type IncomingMessage = { instance: string; phone: string; text: string };

type Payload = {
  event?: string; instance?: string;
  data?: {
    key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean };
    message?: { conversation?: string; extendedTextMessage?: { text?: string } };
  };
};

/** A private text message received by the connected number, or null for anything else. */
export function parseIncomingMessage(body: unknown): IncomingMessage | null {
  const payload = body as Payload | null;
  if (!payload || (payload.event !== "messages.upsert" && payload.event !== "MESSAGES_UPSERT") || !payload.instance) return null;
  const key = payload.data?.key;
  if (!key || key.fromMe || !key.remoteJid || key.remoteJid.endsWith("@g.us") || key.remoteJid.endsWith("@broadcast")) return null;
  // Newer WhatsApp accounts address chats by an internal id (@lid); the phone comes in a separate field.
  const jid = [key.remoteJid, key.remoteJidAlt, key.senderPn].find(value => value?.endsWith("@s.whatsapp.net"));
  const digits = jid?.split("@")[0]?.split(":")[0]?.replace(/\D/g, "");
  const text = payload.data?.message?.conversation ?? payload.data?.message?.extendedTextMessage?.text;
  if (!digits || digits.length < 8 || digits.length > 15 || !text) return null;
  return { instance: payload.instance, phone: `+${digits}`, text };
}

export const OPT_OUT_REPLY = "Pronto, você não vai mais receber os relatórios automáticos por aqui. Se quiser voltar a receber, é só avisar a equipe.";

export type MessageReceipt = { instance: string; messageId: string; status: "delivered" | "read" };

/** Delivery or read confirmation of a message sent by the connected number, or null. */
export function parseMessageReceipt(body: unknown): MessageReceipt | null {
  const payload = body as { event?: string; instance?: string; data?: { keyId?: string; key?: { id?: string }; fromMe?: boolean; status?: string } } | null;
  if (!payload || (payload.event !== "messages.update" && payload.event !== "MESSAGES_UPDATE") || !payload.instance) return null;
  const data = payload.data;
  const messageId = data?.keyId ?? data?.key?.id;
  if (!data || data.fromMe === false || !messageId) return null;
  const status = data.status === "DELIVERY_ACK" ? "delivered" : data.status === "READ" || data.status === "PLAYED" ? "read" : null;
  return status ? { instance: payload.instance, messageId, status } : null;
}
