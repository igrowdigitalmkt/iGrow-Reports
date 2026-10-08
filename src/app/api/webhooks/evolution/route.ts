import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { parseEvolutionMessage, parseEvolutionRecentHistory } from "@/modules/whatsapp/inbox-parse";
import { isRecentQrMessage } from "@/modules/whatsapp/recent-policy";
import { recordInboxMessage, syncQrChatStates, updateInboxStatus } from "@/modules/whatsapp/inbox-store";
import { parseQrChatStates } from "@/modules/whatsapp-qr/chat-state";
import { bindQrPeerLinks, canonicalQrPeers, qrPeerLinks } from "@/modules/whatsapp-qr/peer-identity";
import { isOptOutText, OPT_OUT_REPLY, parseIncomingMessage, parseIncomingRead, parseMessageReceipt } from "@/modules/whatsapp-qr/opt-out";
import { qrGroupSubject, replyFromInstance, validWebhookToken } from "@/modules/whatsapp-qr/server";
import { clearQrInboxForLostSession } from "@/modules/whatsapp-qr/session-lifecycle";
import { isConfirmedQrLogout } from "@/modules/whatsapp-qr/connection-state";

export const runtime = "nodejs";
export const maxDuration = 60;

const INSTANCE = /^igrow-([0-9a-f-]{36})$/;

// Events of the workspace's own number (Evolution API): receipts update the sent messages, every
// message goes to the WhatsApp inbox, and "PARAR"-like replies stop the automatic reports.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const instance = (body as { instance?: unknown } | null)?.instance;
  if (typeof instance !== "string" || !INSTANCE.test(instance)) {
    return Response.json({ error: "Acesso negado." }, { status: 401 });
  }
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Indisponível." }, { status: 503 });
  const agencyId = INSTANCE.exec(instance)![1];

  // A reset disables event processing before the old Evolution instance is removed.
  // The post-reset cutoff also refuses any late webhook from the old session.
  const { data: guard, error: guardError } = await service.from("whatsapp_qr_reset_guards")
    .select("blocked,fresh_after").eq("agency_id", agencyId).maybeSingle();
  if (guardError) return Response.json({ error: "Proteção do WhatsApp indisponível." }, { status: 503 });
  const signature = request.headers.get("x-igrow-token");
  const scoped = !!guard && validWebhookToken(instance, signature, guard.fresh_after);
  const legacy = validWebhookToken(instance, signature);
  if (!scoped && !legacy) return Response.json({ error: "Acesso negado." }, { status: 401 });
  if (guard?.blocked) return Response.json({ ok: true, ignored: "reset_in_progress" });

  // Merge only identities explicitly paired by WhatsApp; never by names or avatars.
  try {
    await bindQrPeerLinks(service, agencyId, qrPeerLinks(body));
  } catch (error) {
    console.error("whatsapp-qr-peer-link", { message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ error: "Identificadores do WhatsApp indisponíveis." }, { status: 503 });
  }

  if (isConfirmedQrLogout(body)) {
    try {
      const removed = await clearQrInboxForLostSession(agencyId);
      return Response.json({ ok: true, detached: true, removed });
    } catch (error) {
      console.error("whatsapp-qr-logout-cleanup-failed", { message: error instanceof Error ? error.message : "unknown" });
      return Response.json({ error: "Limpeza pendente." }, { status: 503 });
    }
  }

  const event = (body as { event?: unknown } | null)?.event;
  // Import the recent private + group bootstrap from this exact pairing. Old
  // instances have legacy signatures and cannot replay their history here.
  if (event === "messages.set" || event === "MESSAGES_SET") {
    const age = guard ? Date.now() - Date.parse(guard.fresh_after) : Infinity;
    if (!scoped || !Number.isFinite(age) || age < 0 || age > 30 * 60_000)
      return Response.json({ ok: true, ignored: "history_not_authorized" });
    const history = parseEvolutionRecentHistory(body).filter(message => isRecentQrMessage(message.sentAt));
    const peers = await canonicalQrPeers(service, agencyId, guard?.fresh_after, history.map(message => message.remoteId));
    for (const message of history) message.remoteId = peers.get(message.remoteId) ?? message.remoteId;
    // Keep group-name lookups bounded and cache repeated groups within the webhook.
    const groupTitles = new Map<string, Promise<string | null>>();
    const resolveGroup = (groupId: string) => {
      let pending = groupTitles.get(groupId);
      if (!pending) {
        pending = qrGroupSubject(instance, groupId, 2500);
        groupTitles.set(groupId, pending);
      }
      return pending;
    };
    let imported = 0;
    for (let start = 0; start < history.length; start += 4) {
      const batch = await Promise.all(history.slice(start, start + 4).map(message =>
        recordInboxMessage(service, { agencyId, connectionId: null, message, historical: true, groupSubject: resolveGroup })
      ));
      imported += batch.filter(result => result?.inserted === true).length;
    }
    return Response.json({ ok: true, imported, received: history.length });
  }

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
    const peers = await canonicalQrPeers(service, agencyId, guard?.fresh_after, chatStates.map(item => item.remoteId));
    for (const item of chatStates) item.remoteId = peers.get(item.remoteId) ?? item.remoteId;
    // Initial history can contain hundreds of groups. Never block the archive-state write on
    // serial group-info requests: Vercel's webhook deadline would otherwise discard the batch.
    // Small live updates can still resolve a missing group title in parallel.
    if (chatStates.length <= 2) {
      await Promise.all(chatStates.map(async state => {
        if (!state.title && state.remoteId.endsWith("@g.us")) {
          const subject = await qrGroupSubject(instance, state.remoteId);
          if (subject) state.title = subject;
        }
      }));
    }
    await syncQrChatStates(service, agencyId, chatStates);
    return Response.json({ ok: true, chats: chatStates.length });
  }

  const inbox = parseEvolutionMessage(body);
  if (inbox && isRecentQrMessage(inbox.sentAt)
    && (!guard || Date.parse(inbox.sentAt) >= Date.parse(guard.fresh_after))) {
    const peers = await canonicalQrPeers(service, agencyId, guard?.fresh_after, [inbox.remoteId]);
    inbox.remoteId = peers.get(inbox.remoteId) ?? inbox.remoteId;
    await recordInboxMessage(service, { agencyId, connectionId: null, message: inbox, groupSubject: groupId => qrGroupSubject(instance, groupId) });
  }

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
