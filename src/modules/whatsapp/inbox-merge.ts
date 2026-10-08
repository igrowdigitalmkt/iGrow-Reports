import type { InboxConversation, InboxList } from "./inbox-types";

function newest(left: InboxConversation, right: InboxConversation) {
  const a = left.lastAt ? Date.parse(left.lastAt) : 0;
  const b = right.lastAt ? Date.parse(right.lastAt) : 0;
  return b - a || right.id.localeCompare(left.id);
}

/** Periodic full snapshot and small, incremental WhatsApp inbox updates share one UI model. */
export function reconcileInboxList(previous: InboxList | null, incoming: InboxList): InboxList {
  if (!incoming.delta || !previous?.ready || !incoming.ready) return incoming;
  if (!incoming.conversations.length) return previous;
  const byId = new Map(previous.conversations.map(row => [row.id, row]));
  for (const row of incoming.conversations) byId.set(row.id, row);
  return { ready: true, conversations: [...byId.values()].sort(newest) };
}

/** Cursor comes from database update timestamps, not the browser clock. */
export function latestInboxCursor(previous: string | null, rows: InboxConversation[]) {
  let cursor = previous;
  for (const row of rows) {
    if (row.updatedAt && (!cursor || Date.parse(row.updatedAt) > Date.parse(cursor))) cursor = row.updatedAt;
  }
  return cursor;
}
