// Rules for replying from the iGrow inbox. Shared by the screen and the server.

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Vercel limits a request body to about 4.5 MB.
export const MAX_REPLY_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_REPLY_TEXT = 4096;

/**
 * Official numbers accept free-form messages only within 24 hours of the customer's last
 * message. The QR Code session has no such limit.
 */
export function replyWindow(channel: "qr" | "official", lastInboundAt: string | null, now: Date) {
  if (channel === "qr") return { open: true, closesAt: null as string | null };
  if (!lastInboundAt) return { open: false, closesAt: null };
  const closes = Date.parse(lastInboundAt) + WINDOW_MS;
  return { open: Number.isFinite(closes) && closes > now.getTime(), closesAt: Number.isFinite(closes) ? new Date(closes).toISOString() : null };
}

const IMAGE = ["image/jpeg", "image/png", "image/webp"];
const VIDEO = ["video/mp4", "video/3gpp"];
const AUDIO = ["audio/mpeg", "audio/ogg", "audio/mp4", "audio/aac", "audio/amr"];
const DOCUMENT = [
  "application/pdf", "text/plain", "text/csv",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

export type ReplyMediaKind = "image" | "video" | "audio" | "document";

/** WhatsApp kind of an attached file, or null when WhatsApp does not accept that type. */
export function replyMediaKind(mime: string, channel: "qr" | "official"): ReplyMediaKind | null {
  const type = mime.toLowerCase().split(";")[0].trim();
  // WebP is a sticker format on the official API; send it as a document there.
  if (IMAGE.includes(type)) return channel === "official" && type === "image/webp" ? "document" : "image";
  if (VIDEO.includes(type)) return "video";
  if (AUDIO.includes(type)) return "audio";
  if (DOCUMENT.includes(type)) return "document";
  return null;
}

export const ACCEPTED_REPLY_FILES = [...IMAGE, ...VIDEO, ...AUDIO, ...DOCUMENT].join(",");
