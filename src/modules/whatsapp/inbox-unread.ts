import type { InboxConversation } from "./inbox-types";

/** Briefly hide a conversation's badge while its read request reaches the server. */
export type OptimisticRead = {
  lastInboundAt: string | null;
  lastAt: string | null;
  preview: string | null;
  expiresAt: number;
};

type ReadSnapshot = Pick<InboxConversation, "unread" | "lastInboundAt" | "lastAt" | "preview">;

/**
 * Never suppress a fresh inbound message: its timestamp or preview differs from the
 * snapshot captured when the conversation was opened. The expiry also restores the
 * real server count if marking the conversation read fails.
 */
export function optimisticReadApplies(item: ReadSnapshot, marker: OptimisticRead | undefined, now: number) {
  return !!marker
    && item.unread > 0
    && now < marker.expiresAt
    && marker.lastInboundAt === item.lastInboundAt
    && marker.lastAt === item.lastAt
    && marker.preview === item.preview;
}

export function optimisticReadSnapshot(item: ReadSnapshot, now: number): OptimisticRead {
  return {
    lastInboundAt: item.lastInboundAt,
    lastAt: item.lastAt,
    preview: item.preview,
    expiresAt: now + 15_000,
  };
}
