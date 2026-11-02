/** Regras puras do canal Instagram Direct: lê o aviso da Meta e decide o que vira lead. */

export type IgMessage = { igAccountId: string; senderId: string; messageId: string; text: string | null; hasAttachment: boolean; at: string; echo: boolean };

type Messaging = { sender?: { id?: unknown }; recipient?: { id?: unknown }; timestamp?: unknown; message?: { mid?: unknown; text?: unknown; is_echo?: unknown; attachments?: unknown } };
const digits = (value: unknown) => typeof value === "string" && /^[0-9]{5,30}$/.test(value) ? value : null;

/** Mensagens recebidas pelas contas profissionais do Instagram (formatos `messaging` e `changes`). */
export function parseInstagramMessages(payload: unknown): IgMessage[] {
  if (!payload || typeof payload !== "object" || (payload as { object?: unknown }).object !== "instagram") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const out: IgMessage[] = [];
  for (const entry of entries as { id?: unknown; messaging?: unknown; changes?: unknown }[]) {
    const igAccountId = digits(entry?.id);
    if (!igAccountId) continue;
    const items: Messaging[] = [];
    if (Array.isArray(entry.messaging)) items.push(...entry.messaging as Messaging[]);
    if (Array.isArray(entry.changes)) for (const change of entry.changes as { field?: unknown; value?: Messaging }[]) if (change?.field === "messages" && change.value) items.push(change.value);
    for (const item of items) {
      const senderId = digits(item?.sender?.id);
      const messageId = typeof item?.message?.mid === "string" && item.message.mid ? item.message.mid.slice(0, 200) : null;
      if (!senderId || !messageId) continue;
      const stamp = Number(item.timestamp);
      const at = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp > 1e12 ? stamp : stamp * 1000).toISOString() : new Date().toISOString();
      const text = typeof item.message?.text === "string" && item.message.text.trim() ? item.message.text.replace(/\s+/g, " ").trim().slice(0, 300) : null;
      out.push({ igAccountId, senderId, messageId, text, hasAttachment: Array.isArray(item.message?.attachments) && item.message.attachments.length > 0, at, echo: item.message?.is_echo === true || senderId === igAccountId });
    }
  }
  return out;
}

/** Só mensagens recebidas de outra pessoa viram lead (eco do que a própria conta enviou, nunca). */
export const shouldCaptureInstagram = (message: IgMessage) => !message.echo && message.senderId !== message.igAccountId;

/** Texto curto da primeira mensagem; mídia sem texto vira um rótulo. */
export const instagramFirstMessage = (message: IgMessage) => message.text ?? (message.hasAttachment ? "[mídia]" : null);

/** @ do Instagram: só letras, números, ponto e sublinhado. */
export function cleanHandle(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim().replace(/^@/, "") : "";
  return /^[A-Za-z0-9._]{1,30}$/.test(text) ? text : null;
}
