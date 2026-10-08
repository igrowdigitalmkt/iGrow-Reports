import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageSender } from "@/modules/automations/sender";
import { EvolutionClient, EvolutionError, evolutionConfig, type EvolutionGroup } from "./evolution";
import { formatJidPhone, instanceNameFor, normalizePairingPhone } from "./format";
import { blockQrInbox, clearBlockedQrInbox, clearOrphanedQrInbox } from "./session-lifecycle";

export type QrStatus =
  | { configured: false }
  | { configured: true; state: "disconnected" }
  | { configured: true; state: "connecting" }
  | { configured: true; state: "connected"; phone: string | null; name: string | null; picture: string | null };

/** Per-session signature of the webhook, derived from the server key: no extra secret to manage. */
export function webhookToken(instance: string, sessionEpoch?: string) {
  const config = evolutionConfig();
  return config ? createHmac("sha256", config.key).update(sessionEpoch ? `webhook:${instance}:${sessionEpoch}` : `webhook:${instance}`).digest("hex") : null;
}

export function validWebhookToken(instance: string, received: string | null, sessionEpoch?: string) {
  const expected = webhookToken(instance, sessionEpoch);
  if (!expected || !received || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function appOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null;
}

function client() {
  const config = evolutionConfig();
  return config ? new EvolutionClient(config) : null;
}

export async function getQrStatus(agencyId: string): Promise<QrStatus> {
  const evolution = client();
  if (!evolution) return { configured: false };
  const name = instanceNameFor(agencyId);
  const state = await evolution.state(name);
  if (state === null) await clearOrphanedQrInbox(agencyId);
  if (state === "open") {
    const instance = await evolution.instance(name);
    return { configured: true, state: "connected", phone: formatJidPhone(instance?.ownerJid ?? null), name: instance?.profileName ?? null, picture: instance?.profilePicUrl ?? null };
  }
  return { configured: true, state: state === "connecting" ? "connecting" : "disconnected" };
}

/** QR Code (default) or 8-character pairing code when a phone number is given. */
export async function startQrConnection(agencyId: string, phone?: string) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("O servidor do WhatsApp ainda não foi configurado.");
  const name = instanceNameFor(agencyId);
  const number = phone ? normalizePairingPhone(phone) ?? undefined : undefined;
  if (phone && !number) throw new EvolutionError("Informe o número com DDD, por exemplo (86) 99999-9999.");
  const state = await evolution.state(name);
  if (state === "open") return { connected: true as const };
  // A fresh pairing, including replacing a closed session, never reuses old
  // customer messages. The 30-second refresh of an in-progress QR is harmless.
  const fresh = state === null || state === "close" || (state === "connecting" && !!number);
  if (fresh) {
    await blockQrInbox(agencyId);
    if (state !== null) await resetQrSession(agencyId);
    await clearBlockedQrInbox(agencyId);
    await evolution.create(name, number);
  }
  const origin = appOrigin();
  // Fresh sessions sign webhooks with the reset timestamp, preventing delayed
  // history from a previously linked phone from leaking into the new inbox.
  const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
  const service = createSupabaseServiceClient();
  if (!service) throw new EvolutionError("Banco indisponível para vincular o WhatsApp.");
  const { data: guard, error: guardError } = await service.from("whatsapp_qr_reset_guards")
    .select("fresh_after").eq("agency_id", agencyId).maybeSingle();
  if (guardError) throw new EvolutionError("Não foi possível proteger a nova sessão.");
  const token = webhookToken(name, guard?.fresh_after);
  if (!origin || !token) throw new EvolutionError("Webhook do WhatsApp não configurado.");
  await evolution.setWebhook(name, `${origin}/api/webhooks/evolution`, token);
  // Resume before starting QR pairing: history can arrive immediately after the scan.
  if (guard) {
    const { error } = await service.rpc("resume_whatsapp_qr_after_reset", { p_agency_id: agencyId });
    if (error) throw new EvolutionError("Falha ao habilitar o WhatsApp novo; tente novamente.");
  }
  const result = await evolution.connect(name, number);
  if (number && !result.pairingCode) throw new EvolutionError("O WhatsApp não gerou o código agora. Tente o QR Code ou tente de novo em instantes.");
  return { connected: false as const, qr: number ? null : result.qr, pairingCode: number ? result.pairingCode : null };
}

/** Sends the confirmation after an opt-out reply, from the agency's own number. */
export async function replyFromInstance(instance: string, phone: string, text: string) {
  const evolution = client();
  if (!evolution) return;
  await evolution.sendText(instance, phone.replace(/\D/g, ""), text).catch(() => undefined);
}

/** Group name for the inbox; null when the session cannot tell. */
export async function qrResolvePeerLinks(agencyId: string, lids: string[]) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("Servidor do WhatsApp não configurado.");
  return evolution.resolvePeerLinks(instanceNameFor(agencyId), lids);
}

export async function qrGroupInfo(agencyId: string, groupJid: string) {
  const evolution = client();
  if (!evolution) return null;
  return evolution.groupInfo(instanceNameFor(agencyId), groupJid).catch(() => null);
}

export async function qrGroupSubject(instance: string, groupJid: string, timeoutMs = 15_000) {
  const evolution = client();
  if (!evolution) return null;
  return evolution.groupSubject(instance, groupJid, timeoutMs).catch(() => null);
}

/** Strict reset: never delete local messages until the Evolution instance is gone. */
export async function resetQrSession(agencyId: string) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("Servidor do WhatsApp não configurado.");
  const name = instanceNameFor(agencyId);
  // Evolution can return "close" from /connectionState even when the instance
  // was already removed. Only /fetchInstances confirms that it still exists.
  if (await evolution.instance(name)) {
    // A disconnected device may reject logout; deletion must still succeed.
    await evolution.logout(name).catch(() => undefined);
    try {
      await evolution.remove(name);
    } catch (error) {
      if (!(error instanceof EvolutionError && error.status === 404)) throw error;
    }
  }
  // Instance deletion may be asynchronous; verify by its exact name rather
  // than treating a cached "close" connection state as an existing session.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!await evolution.instance(name)) return;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw new EvolutionError("A sessão antiga ainda existe; nada foi apagado.");
}

export async function listQrGroups(agencyId: string): Promise<EvolutionGroup[]> {
  const evolution = client();
  if (!evolution) return [];
  const name = instanceNameFor(agencyId);
  if (await evolution.state(name) !== "open") return [];
  return (await evolution.groups(name)).sort((a, b) => a.subject.localeCompare(b.subject, "pt-BR"));
}

const chatJid = (remoteId: string) => remoteId.includes("@") ? remoteId : `${remoteId.replace(/\D/g, "")}@s.whatsapp.net`;

/** Mirrors "read" on the phone for the given received messages. */
export async function markQrRead(agencyId: string, remoteId: string, messageIds: string[]) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("Servidor do WhatsApp não configurado.");
  const remoteJid = chatJid(remoteId);
  await evolution.markRead(instanceNameFor(agencyId),
    messageIds.map(id => ({ remoteJid, fromMe: false, id })), remoteJid);
}

/** Mirrors archiving on the phone. The last message is optional for history-only chats. */
export async function archiveQrChat(agencyId: string, remoteId: string, last: { id: string; fromMe: boolean; sentAt: string } | null, archive: boolean) {
  const evolution = client();
  if (!evolution) return;
  const remoteJid = chatJid(remoteId);
  const lastMessage = last ? { key: { remoteJid, fromMe: last.fromMe, id: last.id }, messageTimestamp: Math.floor(Date.parse(last.sentAt) / 1000) } : undefined;
  await evolution.archive(instanceNameFor(agencyId), remoteJid, lastMessage, archive);
}

/** Profile photo of a contact or group seen by the QR Code session, fetched on demand (not stored). */
export async function qrProfilePicture(agencyId: string, remoteId: string) {
  const evolution = client();
  if (!evolution) return null;
  const number = remoteId.includes("@") ? remoteId : remoteId.replace(/\D/g, "");
  const url = await evolution.profilePictureUrl(instanceNameFor(agencyId), number).catch(() => null);
  // Only WhatsApp's own image servers are fetched.
  if (!url || !/^https:\/\/[a-z0-9.-]+\.(whatsapp\.net|fbcdn\.net)\//i.test(url)) return null;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return null;
  return { bytes: await response.arrayBuffer(), mime: response.headers.get("content-type") ?? "image/jpeg" };
}

/** File of an inbox message on the QR Code session, fetched on demand (not stored). */
export async function downloadQrMedia(agencyId: string, message: { externalId: string; remoteId: string; isGroup: boolean; fromMe: boolean; ref?: { type: string; data: Record<string, unknown> } | null }) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("O servidor do WhatsApp ainda não foi configurado.");
  const remoteJid = message.isGroup || message.remoteId.includes("@") ? message.remoteId : `${message.remoteId}@s.whatsapp.net`;
  return evolution.mediaOfMessage(instanceNameFor(agencyId), { id: message.externalId, remoteJid, fromMe: message.fromMe }, message.ref);
}

/** A reaction is sent to the original WhatsApp key, not as a new chat message. */
export async function sendQrReaction(agencyId: string, remoteId: string, key: {
  externalId: string; fromMe: boolean; participant?: string | null;
}, emoji: string) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("O servidor do WhatsApp não está configurado.");
  const name = instanceNameFor(agencyId);
  if (await evolution.state(name) !== "open") throw new EvolutionError("Seu WhatsApp está desconectado.");
  const remoteJid = remoteId.includes("@") ? remoteId : `${remoteId}@s.whatsapp.net`;
  await evolution.reactToMessage(name, {
    remoteJid, id: key.externalId, fromMe: key.fromMe,
    ...(key.participant ? { participant: key.participant } : {}),
  }, emoji);
}

/** Reply from the inbox through the workspace's QR Code session. Returns the message id. */
export async function sendQrReply(agencyId: string, to: string, content: { text: string; replyTo?: { externalId: string; fromMe: boolean; body: string } } | { voice: string } | { base64: string; filename: string; mime: string; kind: "image" | "video" | "audio" | "document"; caption?: string }) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("O servidor do WhatsApp ainda não foi configurado.");
  const name = instanceNameFor(agencyId);
  if (await evolution.state(name) !== "open") throw new EvolutionError("Seu WhatsApp (QR Code) está desconectado. Conecte de novo em Integrações.");
  // Baileys v7 can require a LID JID to reply to a private chat. Stripping @lid
  // turns the private ID into a nonexistent phone number (Evolution HTTP 400).
  const number = to.endsWith("@g.us") || to.endsWith("@lid") ? to : to.replace(/\D/g, "");
  const sent = "text" in content
    ? await evolution.sendText(name, number, content.text, content.replyTo ? { id: content.replyTo.externalId, fromMe: content.replyTo.fromMe, remoteJid: number.endsWith("@g.us") || number.endsWith("@lid") ? number : `${number}@s.whatsapp.net`, text: content.replyTo.body } : undefined)
    : "voice" in content ? await evolution.sendVoice(name, number, content.voice)
    : await evolution.sendMedia(name, number, { mediatype: content.kind, mimetype: content.mime, base64: content.base64, fileName: content.filename, caption: content.caption });
  return sent.messageId;
}

/** Sender used by scheduled messages; null while the agency's number is not connected. */
export async function createQrSender(agencyId: string): Promise<MessageSender | null> {
  const evolution = client();
  if (!evolution) return null;
  const name = instanceNameFor(agencyId);
  if (await evolution.state(name) !== "open") return null;
  // Do not overwrite webhook settings on every scheduled send. Webhook registration
  // happens during explicit connection; auto-registration here can reactivate an
  // intentionally paused initial history import and overload the database.
  return {
    async sendText(destination, text) {
      const number = destination.kind === "group" ? destination.groupId : destination.phone.replace(/\D/g, "");
      try {
        const sent = await evolution.sendText(name, number, text);
        return { ok: true, messageId: sent.messageId };
      } catch (error) {
        const status = error instanceof EvolutionError ? error.status : 0;
        return { ok: false, error: status === 400 ? "número sem WhatsApp ou grupo indisponível" : "o WhatsApp não aceitou a mensagem" };
      }
    },
  };
}
