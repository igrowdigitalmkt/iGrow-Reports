/** Pure constraints shared by the API and the WhatsApp inbox. */
export function canPinMessages(existing: string[], incoming: string[], limit = 3): boolean {
  return new Set([...existing, ...incoming]).size <= limit;
}

export function canForwardInboxMessage(message: { body?: string | null; kind: string }): boolean {
  return !!message.body?.trim() || ["image", "video", "audio", "document"].includes(message.kind);
}
