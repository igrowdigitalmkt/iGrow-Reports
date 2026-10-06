import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageSender } from "@/modules/automations/sender";
import { EvolutionClient, EvolutionError, evolutionConfig, type EvolutionGroup } from "./evolution";
import { formatJidPhone, instanceNameFor, normalizePairingPhone } from "./format";

export type QrStatus =
  | { configured: false }
  | { configured: true; state: "disconnected" }
  | { configured: true; state: "connecting" }
  | { configured: true; state: "connected"; phone: string | null; name: string | null; picture: string | null };

/** Per-session signature of the webhook, derived from the server key: no extra secret to manage. */
export function webhookToken(instance: string) {
  const config = evolutionConfig();
  return config ? createHmac("sha256", config.key).update(`webhook:${instance}`).digest("hex") : null;
}

export function validWebhookToken(instance: string, received: string | null) {
  const expected = webhookToken(instance);
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
  // A pairing code is only issued to a fresh session created with the number.
  if (state !== null && number) { await evolution.remove(name).catch(() => undefined); }
  if (state === null || number) await evolution.create(name, number);
  const origin = appOrigin();
  const token = webhookToken(name);
  if (origin && token) await evolution.setWebhook(name, `${origin}/api/webhooks/evolution`, token).catch(() => undefined);
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

export async function disconnectQr(agencyId: string) {
  const evolution = client();
  if (!evolution) return;
  const name = instanceNameFor(agencyId);
  await evolution.logout(name).catch(() => undefined);
  await evolution.remove(name).catch(() => undefined);
}

export async function listQrGroups(agencyId: string): Promise<EvolutionGroup[]> {
  const evolution = client();
  if (!evolution) return [];
  const name = instanceNameFor(agencyId);
  if (await evolution.state(name) !== "open") return [];
  return (await evolution.groups(name)).sort((a, b) => a.subject.localeCompare(b.subject, "pt-BR"));
}

/** Sender used by scheduled messages; null while the agency's number is not connected. */
export async function createQrSender(agencyId: string): Promise<MessageSender | null> {
  const evolution = client();
  if (!evolution) return null;
  const name = instanceNameFor(agencyId);
  if (await evolution.state(name) !== "open") return null;
  return {
    async sendText(destination, text) {
      const number = destination.kind === "group" ? destination.groupId : destination.phone.replace(/\D/g, "");
      try {
        await evolution.sendText(name, number, text);
        return { ok: true };
      } catch (error) {
        const status = error instanceof EvolutionError ? error.status : 0;
        return { ok: false, error: status === 400 ? "número sem WhatsApp ou grupo indisponível" : "o WhatsApp não aceitou a mensagem" };
      }
    },
  };
}
