// Shapes shared by the inbox routes and the WhatsApp screen.

export type InboxStatus = "pending" | "sent" | "delivered" | "read" | "failed" | null;

export type InboxChannel = {
  key: string; kind: "qr" | "official"; name: string; phone: string | null; coexistence: boolean;
};

export type InboxConversation = {
  id: string; channelKey: string; remoteId: string; isGroup: boolean; title: string | null;
  clientId: string | null; clientName: string | null; favorite: boolean; unread: number;
  lastAt: string | null; preview: string | null; lastDirection: "in" | "out" | null; lastKind: string | null; lastStatus: InboxStatus;
  lastInboundAt: string | null; archived: boolean; updatedAt?: string;
};

export type InboxMessageItem = {
  id: string; direction: "in" | "out"; kind: string; body: string | null; mediaName: string | null; mediaMime: string | null;
  author: string | null; status: InboxStatus; sentAt: string;
};

/** Recipient registered for a client, offered when starting a conversation. */
export type InboxContact = { id: string; name: string; phone: string; clientName: string | null };

export type InboxList = { ready: boolean; conversations: InboxConversation[]; delta?: boolean };
export type InboxThread = { conversation: InboxConversation | null; messages: InboxMessageItem[] };
