// Chat state events from the QR Code session. Pure parsing only: no database/network access here.

export type QrChatState = {
  remoteId: string;
  archived?: boolean;
  unread?: number;
};

const CHAT_STATE_EVENTS = new Set([
  "chats.set", "CHATS_SET",
  "chats.upsert", "CHATS_UPSERT",
  "chats.update", "CHATS_UPDATE",
]);

function remoteIdOf(value: unknown) {
  if (typeof value !== "string" || value.length < 3 || value.length > 160) return null;
  if (value.endsWith("@g.us") || value.endsWith("@lid")) return value;
  if (value.endsWith("@s.whatsapp.net")) {
    const digits = value.split("@")[0]?.split(":")[0]?.replace(/\D/g, "");
    return digits && digits.length >= 8 && digits.length <= 15 ? digits : null;
  }
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : value;
}

function finiteUnread(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.min(Math.trunc(number), 100_000);
}

/** Archive/unread state emitted by the patched Evolution bridge, or an empty list for other events. */
export function parseQrChatStates(body: unknown): QrChatState[] {
  const payload = body as { event?: unknown; data?: unknown } | null;
  if (!payload || typeof payload.event !== "string" || !CHAT_STATE_EVENTS.has(payload.event)) return [];
  const rows = Array.isArray(payload.data) ? payload.data : payload.data && typeof payload.data === "object" ? [payload.data] : [];
  const result: QrChatState[] = [];
  for (const row of rows) {
    const item = row as Record<string, unknown>;
    const remoteId = remoteIdOf(item.remoteJid ?? item.id);
    if (!remoteId) continue;
    const archived = typeof item.archived === "boolean" ? item.archived : undefined;
    const unread = finiteUnread(item.unreadMessages ?? item.unreadCount);
    if (archived === undefined && unread === undefined) continue;
    result.push({ remoteId, ...(archived === undefined ? {} : { archived }), ...(unread === undefined ? {} : { unread }) });
  }
  return result;
}
