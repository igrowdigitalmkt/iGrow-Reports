/** Low-cost QR inbox: recent replies only, not a full WhatsApp archive. */
export const WHATSAPP_QR_RECENT_DAYS = 7;
const DAY_MS = 86_400_000;

export function isRecentQrMessage(sentAt: string, now = Date.now()) {
  const timestamp = Date.parse(sentAt);
  // Reject old replayed history and malformed future timestamps.
  return Number.isFinite(timestamp)
    && timestamp >= now - WHATSAPP_QR_RECENT_DAYS * DAY_MS
    && timestamp <= now + DAY_MS;
}
