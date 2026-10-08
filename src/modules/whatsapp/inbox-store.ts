import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { InboxMessage } from "./inbox-parse";
import type { InboxReactionEvent } from "./inbox-reactions";

type Service = SupabaseClient<Database>;

/**
 * Records one inbox message. Before migration 202610070011 the function does not exist and the
 * call is a no-op, so webhooks keep working for receipts and "PARAR" replies.
 */
export async function recordInboxMessage(service: Service, input: {
  agencyId: string; connectionId: string | null; message: InboxMessage; status?: "sent" | "delivered" | "read" | "failed" | null;
  historical?: boolean;
  groupSubject?: (groupId: string) => Promise<string | null>;
}) {
  const { message } = input;
  const args = {
    p_agency_id: input.agencyId, p_connection_id: input.connectionId, p_remote_id: message.remoteId, p_is_group: message.isGroup,
    p_title: message.title, p_external_id: message.externalId, p_direction: message.direction, p_kind: message.kind,
    p_body: message.body, p_media_name: message.mediaName, p_media_mime: message.mediaMime, p_author: message.author,
    p_status: message.direction === "out" ? input.status ?? message.deliveryStatus ?? "sent" : null, p_sent_at: message.sentAt,
  };
  // Historical direct and group messages do not generate new unread notifications.
  // The separate atomic SQL function preserves the phone's existing unread counters.
  const recordFunction = input.historical ? "record_whatsapp_history_message" : "record_whatsapp_message";
  let { data, error } = await service.rpc(recordFunction, { ...args, p_media_id: message.mediaId ?? null });
  // Before migration 202610070012 the live function has no media id parameter.
  if (!input.historical && error?.code === "PGRST202") ({ data, error } = await service.rpc("record_whatsapp_message", args));
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883") console.error("whatsapp-inbox-record", { code: error.code });
    return null;
  }
  const row = data?.[0];
  // QR Code files are fetched later by their reference (no-op before migration 202610070013).
  if (message.mediaRef) await service.rpc("set_whatsapp_message_media_ref", { p_agency_id: input.agencyId, p_external_id: message.externalId, p_media_ref: message.mediaRef as unknown as Json }).then(() => undefined, () => undefined);
  // A group seen for the first time gets its name from the session.
  if (row?.needs_title && message.isGroup && input.groupSubject) {
    const subject = await input.groupSubject(message.remoteId);
    if (subject) await service.rpc("set_whatsapp_conversation_title", { p_conversation_id: row.conversation_id, p_title: subject });
  }
  return row ?? null;
}

/** Apply one reaction to its original saved message, without altering unread/preview. */
export async function recordInboxReaction(service: Service, input: {
  agencyId: string; connectionId: string | null; reaction: InboxReactionEvent;
}): Promise<boolean> {
  const { agencyId, connectionId, reaction } = input;
  const { data, error } = await service.rpc("record_whatsapp_message_reaction", {
    p_agency_id: agencyId, p_connection_id: connectionId, p_remote_id: reaction.remoteId,
    p_target_external_id: reaction.targetExternalId, p_reactor_id: reaction.reactorId,
    p_emoji: reaction.emoji, p_at: reaction.at,
  });
  if (error) {
    console.error("whatsapp-reaction-record", { code: error.code });
    throw new Error("Falha ao salvar reação do WhatsApp.");
  }
  return data === true;
}

/** Delivery/read of a message sent by the number (no-op before migration 202610070011). */
export async function updateInboxStatus(service: Service, agencyId: string | null, externalId: string, status: "sent" | "delivered" | "read" | "failed") {
  await service.rpc("update_whatsapp_message_status", { p_agency_id: agencyId, p_external_id: externalId, p_status: status }).then(() => undefined, () => undefined);
}

/** Mirrors the phone's authoritative archive/unread state in one database round trip. */
export async function syncQrChatStates(service: Service, agencyId: string, states: Array<{ remoteId: string; title?: string; archived?: boolean; unread?: number }>) {
  if (!states.length) return 0;
  const payload = states.map(state => ({
    remote_id: state.remoteId,
    ...(state.title === undefined ? {} : { title: state.title }),
    ...(state.archived === undefined ? {} : { archived: state.archived }),
    ...(state.unread === undefined ? {} : { unread_count: state.unread }),
  })) as unknown as Json;
  const { data, error } = await service.rpc("sync_whatsapp_qr_chat_states", { p_agency_id: agencyId, p_states: payload });
  if (error) {
    // The webhook must remain available during a rolling deploy where the migration may arrive first/last.
    if (error.code !== "PGRST202" && error.code !== "42883") console.error("whatsapp-chat-state-sync", { code: error.code });
    return 0;
  }
  return data ?? 0;
}
