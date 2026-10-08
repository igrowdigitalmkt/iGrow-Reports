// Turns WhatsApp webhooks (Evolution for the QR Code session, Cloud API for official numbers)
// into inbox messages. Pure functions: no database or network here.

export type InboxKind = "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "contact" | "reaction" | "template" | "other";

export type InboxMessage = {
  remoteId: string; isGroup: boolean; title: string | null; author: string | null;
  externalId: string; direction: "in" | "out"; kind: InboxKind;
  body: string | null; mediaName: string | null; mediaMime: string | null; sentAt: string;
  // Cloud API media id (the QR Code session finds files by the message id instead).
  mediaId?: string | null;
  /** Sender JID for group messages, used to target the original key for reactions. */
  participantJid?: string | null;
  deliveryStatus?: "sent" | "delivered" | "read" | "failed" | null;
  // QR Code session: WhatsApp's encrypted file reference (location and key, no content).
  mediaRef?: MediaRef | null;
};

export type MediaRef = { type: string; data: Record<string, unknown> };
const MEDIA_TYPES = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"] as const;
// Only what WhatsApp needs to fetch the file again; thumbnails and captions stay out.
const REF_FIELDS = ["url", "directPath", "mediaKey", "mediaKeyTimestamp", "mimetype", "fileEncSha256", "fileSha256", "fileLength", "fileName", "seconds", "ptt", "width", "height"];

/** File reference of a Baileys media message, or null for anything else. */
export function baileysMediaRef(message: BaileysContent | undefined): MediaRef | null {
  if (!message) return null;
  const inner = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message ?? message.documentWithCaptionMessage?.message;
  if (inner) return baileysMediaRef(inner);
  for (const type of MEDIA_TYPES) {
    const media = message[type] as Record<string, unknown> | undefined;
    if (!media || typeof media !== "object" || (!media.directPath && !media.url) || !media.mediaKey) continue;
    return { type, data: Object.fromEntries(REF_FIELDS.filter(field => media[field] != null).map(field => [field, media[field]])) };
  }
  return null;
}

const text = (value: unknown, max = 8000) => typeof value === "string" && value.trim() ? value.slice(0, max) : null;
const seconds = (value: unknown) => {
  const number = typeof value === "object" && value !== null && "low" in value ? Number((value as { low: unknown }).low) : Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : null;
};

type BaileysContent = Record<string, unknown> & {
  conversation?: string; extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string; mimetype?: string }; videoMessage?: { caption?: string; mimetype?: string };
  audioMessage?: { mimetype?: string; ptt?: boolean }; documentMessage?: { caption?: string; fileName?: string; title?: string; mimetype?: string };
  documentWithCaptionMessage?: { message?: BaileysContent }; stickerMessage?: { mimetype?: string };
  locationMessage?: { name?: string; address?: string }; liveLocationMessage?: unknown;
  contactMessage?: { displayName?: string }; contactsArrayMessage?: { displayName?: string };
  reactionMessage?: { text?: string }; templateMessage?: unknown; buttonsResponseMessage?: { selectedDisplayText?: string };
  listResponseMessage?: { title?: string }; pollCreationMessage?: { name?: string }; pollCreationMessageV3?: { name?: string };
  ephemeralMessage?: { message?: BaileysContent }; viewOnceMessage?: { message?: BaileysContent }; viewOnceMessageV2?: { message?: BaileysContent };
  protocolMessage?: unknown; senderKeyDistributionMessage?: unknown; messageContextInfo?: unknown;
};

/** Kind, text and file of a Baileys message; null for technical messages (deletes, key exchange…). */
export function describeBaileysContent(message: BaileysContent | undefined): Pick<InboxMessage, "kind" | "body" | "mediaName" | "mediaMime"> | null {
  if (!message) return null;
  const inner = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message ?? message.documentWithCaptionMessage?.message;
  if (inner) return describeBaileysContent(inner);
  const plain = text(message.conversation) ?? text(message.extendedTextMessage?.text);
  if (plain) return { kind: "text", body: plain, mediaName: null, mediaMime: null };
  if (message.imageMessage) return { kind: "image", body: text(message.imageMessage.caption), mediaName: null, mediaMime: text(message.imageMessage.mimetype, 120) };
  if (message.videoMessage) return { kind: "video", body: text(message.videoMessage.caption), mediaName: null, mediaMime: text(message.videoMessage.mimetype, 120) };
  if (message.audioMessage) return { kind: "audio", body: null, mediaName: null, mediaMime: text(message.audioMessage.mimetype, 120) };
  if (message.documentMessage) return { kind: "document", body: text(message.documentMessage.caption), mediaName: text(message.documentMessage.fileName ?? message.documentMessage.title, 255), mediaMime: text(message.documentMessage.mimetype, 120) };
  if (message.stickerMessage) return { kind: "sticker", body: null, mediaName: null, mediaMime: null };
  if (message.locationMessage || message.liveLocationMessage) return { kind: "location", body: text(message.locationMessage?.name) ?? text(message.locationMessage?.address), mediaName: null, mediaMime: null };
  if (message.contactMessage || message.contactsArrayMessage) return { kind: "contact", body: text(message.contactMessage?.displayName) ?? text(message.contactsArrayMessage?.displayName), mediaName: null, mediaMime: null };
  // Reactions are linked to their target, never a new chat bubble.
  if (message.reactionMessage) return null;
  const answer = text(message.buttonsResponseMessage?.selectedDisplayText) ?? text(message.listResponseMessage?.title);
  if (answer) return { kind: "text", body: answer, mediaName: null, mediaMime: null };
  const poll = text(message.pollCreationMessage?.name) ?? text(message.pollCreationMessageV3?.name);
  if (poll) return { kind: "other", body: `📊 ${poll}`, mediaName: null, mediaMime: null };
  if (message.templateMessage) return { kind: "template", body: null, mediaName: null, mediaMime: null };
  if (message.protocolMessage || message.senderKeyDistributionMessage) return null;
  const known = Object.keys(message).filter(key => key !== "messageContextInfo");
  return known.length ? { kind: "other", body: null, mediaName: null, mediaMime: null } : null;
}

const jidDigits = (jid: string | undefined) => jid?.endsWith("@s.whatsapp.net") ? jid.split("@")[0]!.split(":")[0]!.replace(/\D/g, "") : null;

type EvolutionPayload = {
  event?: string;
  data?: {
    key?: { remoteJid?: string; remoteJidAlt?: string; senderPn?: string; fromMe?: boolean; id?: string; participant?: string; participantAlt?: string };
    pushName?: string; message?: BaileysContent; messageTimestamp?: unknown; status?: string;
  };
};
const EVOLUTION_MESSAGE_EVENTS = new Set(["messages.upsert", "MESSAGES_UPSERT", "send.message", "SEND_MESSAGE"]);
export function normalizeEvolutionMessageStatus(status: unknown): InboxMessage["deliveryStatus"] {
  if (status === null || status === undefined) return null;
  const value = typeof status === "number" ? status : typeof status === "string" ? status.trim().toUpperCase() : "";
  if (value === "READ" || value === "PLAYED" || value === 4 || value === 5 || value === "4" || value === "5") return "read";
  if (value === "DELIVERY_ACK" || value === 3 || value === "3") return "delivered";
  if (value === "ERROR" || value === 0 || value === "0") return "failed";
  if (value === "SERVER_ACK" || value === "PENDING" || value === 1 || value === 2 || value === "1" || value === "2") return "sent";
  return null;
}

/** A message received or sent by the QR Code session (phone, WhatsApp Web or the iGrow), or null. */
export function parseEvolutionMessage(body: unknown, now = new Date()): InboxMessage | null {
  const payload = body as EvolutionPayload | null;
  if (!payload?.event || !EVOLUTION_MESSAGE_EVENTS.has(payload.event)) return null;
  const key = payload.data?.key;
  const remoteJid = key?.remoteJid;
  if (!key?.id || !remoteJid || remoteJid.endsWith("@broadcast") || remoteJid.endsWith("@newsletter")) return null;
  const isGroup = remoteJid.endsWith("@g.us");
  // Newer accounts address chats by an internal id (@lid); the phone comes in a separate field.
  const phone = isGroup ? null : [remoteJid, key.remoteJidAlt, key.senderPn].map(jidDigits).find(Boolean);
  const remoteId = isGroup ? remoteJid : phone ?? remoteJid;
  if (remoteId.length < 3 || remoteId.length > 120) return null;
  const content = describeBaileysContent(payload.data?.message);
  if (!content) return null;
  const fromMe = key.fromMe === true || payload.event === "send.message" || payload.event === "SEND_MESSAGE";
  const receivedPushName = text(payload.data?.pushName, 200);
  // The numeric @lid identity is not the contact's name.
  const pushName = receivedPushName && !/^\d{12,20}$/.test(receivedPushName) ? receivedPushName : null;
  return {
    remoteId, isGroup, ...content,
    ...(isGroup && !fromMe && /^\d{8,20}@(lid|s\.whatsapp\.net)$/.test(key.participantAlt ?? key.participant ?? "")
      ? { participantJid: key.participantAlt ?? key.participant } : {}),
    // In a private chat the sender's name names the conversation; in a group it names the author.
    title: !isGroup && !fromMe ? pushName : null,
    author: isGroup && !fromMe ? pushName ?? jidDigits(key.participantAlt ?? key.participant ?? undefined) : null,
    externalId: key.id.slice(0, 200), direction: fromMe ? "out" : "in",
    sentAt: seconds(payload.data?.messageTimestamp) ?? now.toISOString(),
    mediaRef: baileysMediaRef(payload.data?.message),
    ...(fromMe && normalizeEvolutionMessageStatus(payload.data?.status) ? { deliveryStatus: normalizeEvolutionMessageStatus(payload.data?.status) } : {}),
  };
}

/**
 * Initial/relinked WhatsApp history: accept recent private and group messages.
 * Live MESSAGES_UPSERT remains independent from historical imports.
 */
export function parseEvolutionRecentHistory(body: unknown): InboxMessage[] {
  const payload = body as { event?: unknown; data?: unknown } | null;
  if (payload?.event !== "messages.set" && payload?.event !== "MESSAGES_SET") return [];
  if (!Array.isArray(payload.data)) return [];
  const history: InboxMessage[] = [];
  // Evolution sends at most 20 messages per batch. Refuse oversized or malformed
  // historical payloads before performing any database work.
  if (payload.data.length > 20) return [];
  for (const item of payload.data) {
    const stamp = (item as { messageTimestamp?: unknown } | null)?.messageTimestamp;
    if (stamp === undefined || stamp === null || !Number.isFinite(Number(stamp))) continue;
    const parsed = parseEvolutionMessage({ event: "MESSAGES_UPSERT", data: item });
    if (parsed && !parsed.remoteId.endsWith("@broadcast") && !parsed.remoteId.endsWith("@newsletter")) {
      history.push(parsed);
    }
  }
  return history;
}

type CloudMedia = { id?: string; mime_type?: string };
type CloudMessage = {
  id?: string; from?: string; to?: string; timestamp?: string; type?: string;
  text?: { body?: string }; image?: CloudMedia & { caption?: string }; video?: CloudMedia & { caption?: string };
  audio?: CloudMedia; voice?: CloudMedia; document?: CloudMedia & { caption?: string; filename?: string };
  sticker?: CloudMedia; location?: { name?: string; address?: string }; contacts?: Array<{ name?: { formatted_name?: string } }>;
  reaction?: { emoji?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
};

function describeCloudMessage(message: CloudMessage): Pick<InboxMessage, "kind" | "body" | "mediaName" | "mediaMime"> | null {
  switch (message.type) {
    case "text": return text(message.text?.body) ? { kind: "text", body: text(message.text?.body), mediaName: null, mediaMime: null } : null;
    case "image": return { kind: "image", body: text(message.image?.caption), mediaName: null, mediaMime: text(message.image?.mime_type, 120) };
    case "video": return { kind: "video", body: text(message.video?.caption), mediaName: null, mediaMime: text(message.video?.mime_type, 120) };
    case "audio": case "voice": return { kind: "audio", body: null, mediaName: null, mediaMime: text((message.audio ?? message.voice)?.mime_type, 120) };
    case "document": return { kind: "document", body: text(message.document?.caption), mediaName: text(message.document?.filename, 255), mediaMime: text(message.document?.mime_type, 120) };
    case "sticker": return { kind: "sticker", body: null, mediaName: null, mediaMime: null };
    case "location": return { kind: "location", body: text(message.location?.name) ?? text(message.location?.address), mediaName: null, mediaMime: null };
    case "contacts": return { kind: "contact", body: text(message.contacts?.[0]?.name?.formatted_name), mediaName: null, mediaMime: null };
    case "reaction": return null;
    case "button": return { kind: "text", body: text(message.button?.text), mediaName: null, mediaMime: null };
    case "interactive": return { kind: "text", body: text(message.interactive?.button_reply?.title) ?? text(message.interactive?.list_reply?.title), mediaName: null, mediaMime: null };
    case "unsupported": case "system": case undefined: return null;
    default: return { kind: "other", body: null, mediaName: null, mediaMime: null };
  }
}

export type CloudInboxMessage = InboxMessage & { phoneNumberId: string };

/**
 * Messages received by official numbers (field "messages") and, for coexistence numbers, the
 * ones sent from the WhatsApp Business app (field "smb_message_echoes").
 */
export function parseCloudMessages(payload: unknown, now = new Date()): CloudInboxMessage[] {
  const result: CloudInboxMessage[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return result;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: { metadata?: { phone_number_id?: string }; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>; messages?: CloudMessage[]; message_echoes?: CloudMessage[] } })?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || typeof phoneNumberId !== "string" || !/^\d{5,30}$/.test(phoneNumberId)) continue;
      const names = new Map((value.contacts ?? []).map(contact => [contact.wa_id, text(contact.profile?.name, 200)]));
      const add = (message: CloudMessage, direction: "in" | "out") => {
        const remote = (direction === "in" ? message.from : message.to)?.replace(/\D/g, "");
        if (!message.id || !remote || remote.length < 8 || remote.length > 15) return;
        const content = describeCloudMessage(message);
        if (!content) return;
        const media = message.image ?? message.video ?? message.audio ?? message.voice ?? message.document ?? message.sticker;
        result.push({
          phoneNumberId, remoteId: remote, isGroup: false, ...content, mediaId: text(media?.id, 200),
          title: direction === "in" ? names.get(message.from) ?? null : null, author: null,
          externalId: message.id.slice(0, 200), direction, sentAt: seconds(message.timestamp) ?? now.toISOString(),
        });
      };
      for (const message of value.messages ?? []) add(message, "in");
      for (const message of value.message_echoes ?? []) add(message, "out");
    }
  }
  return result;
}
