import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, WhatsAppConversationRow } from "@/types/database";
import type { InboxConversation, InboxList, InboxThread } from "./inbox-types";

type Client = SupabaseClient<Database>;

function toConversation(row: WhatsAppConversationRow, clientNames: Map<string, string>): InboxConversation {
  return {
    id: row.id, channelKey: row.channel_key, remoteId: row.remote_id, isGroup: row.is_group, title: row.title,
    clientId: row.client_id, clientName: row.client_id ? clientNames.get(row.client_id) ?? null : null, favorite: row.favorite, unread: row.unread_count,
    lastAt: row.last_message_at, preview: row.last_message_preview, lastDirection: row.last_message_direction, lastKind: row.last_message_kind,
    lastStatus: row.last_message_status, lastInboundAt: row.last_inbound_at, archived: row.archived ?? false, updatedAt: row.updated_at,
  };
}

async function clientNames(supabase: Client, agencyId: string, ids: Array<string | null>) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await supabase.from("clients").select("id,name").eq("agency_id", agencyId).in("id", unique);
  return new Map((data ?? []).map(client => [client.id, client.name]));
}

/**
 * Load every conversation, including old archived chats with no recent message.
 * PostgREST applies a server-side page limit (typically 1,000); using one .limit(400)
 * silently hid older archived chats after the first full WhatsApp history sync.
 */
export async function loadInbox(supabase: Client, agencyId: string): Promise<InboxList> {
  const pageSize = 1000;
  const maxPages = 10;
  const rows: WhatsAppConversationRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    const start = page * pageSize;
    const { data, error } = await supabase.from("whatsapp_conversations").select("*").eq("agency_id", agencyId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(start, start + pageSize - 1);
    if (error || !data) return { ready: false, conversations: [] };
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  const names = await clientNames(supabase, agencyId, rows.map(row => row.client_id));
  return { ready: true, conversations: rows.map(row => toConversation(row, names)) };
}

/**
 * Lightweight polling: transfer only chats whose state or preview changed since the
 * last successful sync. Full reconciliation still runs periodically for deletions.
 */
export async function loadInboxChanges(supabase: Client, agencyId: string, since: string): Promise<InboxList> {
  const pageSize = 1000;
  const rows: WhatsAppConversationRow[] = [];
  for (let page = 0; page < 10; page++) {
    const start = page * pageSize;
    const { data, error } = await supabase.from("whatsapp_conversations").select("*").eq("agency_id", agencyId)
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(start, start + pageSize - 1);
    if (error || !data) return { ready: false, conversations: [], delta: true };
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  const names = await clientNames(supabase, agencyId, rows.map(row => row.client_id));
  return { ready: true, conversations: rows.map(row => toConversation(row, names)), delta: true };
}

/** One conversation with its latest messages, oldest first. */
export async function loadThread(supabase: Client, agencyId: string, conversationId: string): Promise<InboxThread> {
  const [{ data: row }, { data: messages }] = await Promise.all([
    supabase.from("whatsapp_conversations").select("*").eq("agency_id", agencyId).eq("id", conversationId).maybeSingle(),
    supabase.from("whatsapp_messages").select("id,direction,kind,body,media_name,media_mime,author,status,sent_at").eq("agency_id", agencyId)
      .eq("conversation_id", conversationId).order("sent_at", { ascending: false }).limit(300),
  ]);
  if (!row) return { conversation: null, messages: [] };
  const names = await clientNames(supabase, agencyId, [row.client_id]);
  return {
    conversation: toConversation(row, names),
    messages: (messages ?? []).reverse().map(message => ({
      id: message.id, direction: message.direction, kind: message.kind, body: message.body, mediaName: message.media_name,
      mediaMime: message.media_mime, author: message.author, status: message.status, sentAt: message.sent_at,
    })),
  };
}
