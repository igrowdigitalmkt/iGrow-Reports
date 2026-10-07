import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { InboxMessage } from "./inbox-parse";

type Service = SupabaseClient<Database>;

/**
 * Records one inbox message. Before migration 202610070011 the function does not exist and the
 * call is a no-op, so webhooks keep working for receipts and "PARAR" replies.
 */
export async function recordInboxMessage(service: Service, input: {
  agencyId: string; connectionId: string | null; message: InboxMessage; status?: "sent" | "delivered" | "read" | "failed" | null;
  groupSubject?: (groupId: string) => Promise<string | null>;
}) {
  const { message } = input;
  const { data, error } = await service.rpc("record_whatsapp_message", {
    p_agency_id: input.agencyId, p_connection_id: input.connectionId, p_remote_id: message.remoteId, p_is_group: message.isGroup,
    p_title: message.title, p_external_id: message.externalId, p_direction: message.direction, p_kind: message.kind,
    p_body: message.body, p_media_name: message.mediaName, p_media_mime: message.mediaMime, p_author: message.author,
    p_status: message.direction === "out" ? input.status ?? "sent" : null, p_sent_at: message.sentAt,
  });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") console.error("whatsapp-inbox-record", { code: error.code });
    return null;
  }
  const row = data?.[0];
  // A group seen for the first time gets its name from the session.
  if (row?.needs_title && message.isGroup && input.groupSubject) {
    const subject = await input.groupSubject(message.remoteId);
    if (subject) await service.rpc("set_whatsapp_conversation_title", { p_conversation_id: row.conversation_id, p_title: subject });
  }
  return row ?? null;
}

/** Delivery/read of a message sent by the number (no-op before migration 202610070011). */
export async function updateInboxStatus(service: Service, agencyId: string | null, externalId: string, status: "sent" | "delivered" | "read" | "failed") {
  await service.rpc("update_whatsapp_message_status", { p_agency_id: agencyId, p_external_id: externalId, p_status: status }).then(() => undefined, () => undefined);
}
