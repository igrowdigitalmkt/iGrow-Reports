/** Pure constraints shared by the API and the WhatsApp inbox. */
export const WA_REVOKE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function canDeleteOwnMessage(message: { direction: "in" | "out"; revoked?: boolean | null }): boolean {
  return message.direction === "out" && !message.revoked;
}

/** Conservative limit: WhatsApp help says approximately two days.
 * The sender must have a real WhatsApp key and a QR-linked session. */
export function canRevokeForEveryone(message: {
  direction: "in" | "out"; revoked?: boolean | null;
  externalId: string; sentAt: string; channel: "qr" | "official";
}, now = Date.now()) {
  const age = now - Date.parse(message.sentAt);
  return canDeleteOwnMessage(message)
    && message.channel === "qr"
    && !!message.externalId && !message.externalId.startsWith("igrow-")
    && Number.isFinite(age) && age >= 0 && age <= WA_REVOKE_MAX_AGE_MS;
}

export function canPinMessages(existing: string[], incoming: string[], limit = 3): boolean {
  return new Set([...existing, ...incoming]).size <= limit;
}

export function canForwardInboxMessage(message: { body?: string | null; kind: string }): boolean {
  return !!message.body?.trim() || ["image", "video", "audio", "document"].includes(message.kind);
}
