import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseEvolutionMessage } from "@/modules/whatsapp/inbox-parse";
import { recordInboxMessage, syncQrChatStates, updateInboxStatus } from "@/modules/whatsapp/inbox-store";
import { parseQrChatStates } from "@/modules/whatsapp-qr/chat-state";
import { isOptOutText, OPT_OUT_REPLY, parseIncomingMessage, parseIncomingRead, parseMessageReceipt } from "@/modules/whatsapp-qr/opt-out";
import { qrGroupSubject, replyFromInstance, validWebhookToken } from "@/modules/whatsapp-qr/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const INSTANCE = /^igrow-([0-9a-f-]{36})$/;

// Events of the workspace's own number (Evolution API): receipts update the sent messages, every
// message goes to the WhatsApp inbox, and "PARAR"-like replies stop the automatic reports.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const instance = (body as { instance?: unknown } | null)?.instance;
  if (typeof instance !== "string" || !INSTANCE.test(instance) || !validWebhookToken(instance, request.headers.get("x-igrow-token"))) {
    return Response.json({ error: "Acesso negado." }, { status: 401 });
  }
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Indisponível." }, { status: 503 });
  const agencyId = INSTANCE.exec(instance)![1];

  const receipt = parseMessageReceipt(body);
  if (receipt) {
    const at = new Date().toISOString();
    // Statuses only move forward: sent → delivered → read. A read also implies delivered.
    await service.from("automation_messages").update({ delivered_at: at }).eq("agency_id", agencyId).eq("message_id", receipt.messageId).is("delivered_at", null);
    if (receipt.status === "read") await service.from("automation_messages").update({ status: "read", read_at: at }).eq("agency_id", agencyId).eq("message_id", receipt.messageId).in("status", ["sent", "delivered"]);
    else await service.from("automation_messages").update({ status: "delivered" }).eq("agency_id", agencyId).eq("message_id", receipt.messageId).eq("status", "sent");
    await updateInboxStatus(service, agencyId, receipt.messageId, receipt.status);
    return Response.json({ ok: true });
  }

  // Read on the phone: the conversation is read here too (fallback when WhatsApp emits a message receipt).
  const incomingRead = parseIncomingRead(body);
  if (incomingRead) {
    await service.rpc("mark_whatsapp_read_by_message", { p_agency_id: agencyId, p_external_id: incomingRead.messageId }).then(() => undefined, () => undefined);
    return Response.json({ ok: true });
  }

  // Authoritative chat state from Baileys: archive/unarchive and unread count, including initial sync.
  const chatStates = parseQrChatStates(body);
  if (chatStates.length) {
    await syncQrChatStates(service, agencyId, chatStates);
    return Response.json({ ok: true, chats: chatStates.length });
  }

  const inbox = parseEvolutionMessage(body);
  if (inbox) await recordInboxMessage(service, { agencyId, connectionId: null, message: inbox, groupSubject: groupId => qrGroupSubject(instance, groupId) });

  const message = parseIncomingMessage(body);
  if (!message || !isOptOutText(message.text)) return Response.json({ ok: true });
  const { data: count, error } = await service.rpc("service_recipient_opt_out", {
    p_agency_id: agencyId, p_phone: message.phone, p_source: "Resposta de descadastro no WhatsApp",
  });
  if (error) {
    console.error("evolution-opt-out-failed", { code: error.code });
    return Response.json({ error: "Falha ao registrar." }, { status: 500 });
  }
  if (count && count > 0) await replyFromInstance(instance, message.phone, OPT_OUT_REPLY);
  return Response.json({ ok: true, revoked: count ?? 0 });
}
