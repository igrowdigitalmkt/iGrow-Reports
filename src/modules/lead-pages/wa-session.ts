import "server-only";

import { EvolutionClient, EvolutionError, evolutionConfig } from "@/modules/whatsapp-qr/evolution";
import { formatJidPhone, normalizePairingPhone } from "@/modules/whatsapp-qr/format";
import { webhookToken } from "@/modules/whatsapp-qr/server";
import type { Service } from "./hub-query";

/**
 * Sessão de captação de leads por WhatsApp (QR Code): uma instância do Evolution por cliente, separada da caixa da agência.
 * Serve só para perceber contatos novos; a conversa continua no celular do cliente. Nada aqui grava mensagens na caixa.
 */

export type LeadWaMode = "all" | "ads" | "manual";
export type LeadWaView = {
  configured: boolean;
  /** none = ainda sem sessão cadastrada. */
  state: "none" | "disconnected" | "connecting" | "connected";
  phone: string | null; name: string | null; qualifyMode: LeadWaMode; ignoredNumbers: string[]; lastEventAt: string | null;
};

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const LEAD_INSTANCE = new RegExp(`^igrow-lead-(${UUID_PART})$`);
export const leadInstanceName = (sessionId: string) => `igrow-lead-${sessionId}`;
const WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "CONNECTION_UPDATE"];

const client = () => { const config = evolutionConfig(); return config ? new EvolutionClient(config) : null; };
const origin = () => process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null;

/** Só dígitos com DDI; ignora o que não parece telefone. */
export function cleanIgnoredNumbers(values: string[]): string[] {
  const out = new Set<string>();
  for (const value of values) { const digits = normalizePairingPhone(value); if (digits) out.add(digits); }
  return [...out].slice(0, 200);
}

async function findSession(service: Service, clientId: string) {
  const { data } = await service.from("lead_whatsapp_sessions").select("id,agency_id,qualify_mode,ignored_numbers,active,connected_phone,last_event_at").eq("client_id", clientId).maybeSingle();
  return data;
}

export async function getLeadWaView(service: Service, clientId: string): Promise<LeadWaView> {
  const evolution = client();
  const session = await findSession(service, clientId);
  const base = { phone: session?.connected_phone ?? null, name: null as string | null, qualifyMode: (session?.qualify_mode ?? "all") as LeadWaMode, ignoredNumbers: session?.ignored_numbers ?? [], lastEventAt: session?.last_event_at ?? null };
  if (!evolution) return { configured: false, state: session ? "disconnected" : "none", ...base };
  if (!session) return { configured: true, state: "none", ...base };
  const name = leadInstanceName(session.id);
  const state = await evolution.state(name).catch(() => null);
  if (state === "open") {
    const instance = await evolution.instance(name).catch(() => null);
    const phone = formatJidPhone(instance?.ownerJid ?? null) ?? base.phone;
    if (phone && phone !== session.connected_phone) await service.from("lead_whatsapp_sessions").update({ connected_phone: phone, updated_at: new Date().toISOString() }).eq("id", session.id);
    return { configured: true, state: "connected", ...base, phone, name: instance?.profileName ?? null };
  }
  return { configured: true, state: state === "connecting" ? "connecting" : "disconnected", ...base };
}

/** Garante a sessão do cliente e devolve o QR Code (ou o código de pareamento com número). */
export async function startLeadWaSession(service: Service, input: { agencyId: string; clientId: string; userId: string | null; phone?: string }) {
  const evolution = client();
  if (!evolution) throw new EvolutionError("O servidor do WhatsApp ainda não foi configurado.");
  const number = input.phone ? normalizePairingPhone(input.phone) ?? undefined : undefined;
  if (input.phone && !number) throw new EvolutionError("Informe o número com DDD, por exemplo (86) 99999-9999.");
  let session = await findSession(service, input.clientId);
  if (!session) {
    const created = await service.from("lead_whatsapp_sessions").insert({ agency_id: input.agencyId, client_id: input.clientId, created_by: input.userId }).select("id,agency_id,qualify_mode,ignored_numbers,active,connected_phone,last_event_at").single();
    if (created.error || !created.data) throw new EvolutionError("Não foi possível preparar a sessão do WhatsApp deste cliente.");
    session = created.data;
  }
  if (session.agency_id !== input.agencyId) throw new EvolutionError("Sessão indisponível.");
  const name = leadInstanceName(session.id);
  const state = await evolution.state(name);
  if (state === "open") return { connected: true as const };
  if (state === null || state === "close" || (state === "connecting" && !!number)) {
    if (state !== null) await removeInstance(evolution, name);
    await evolution.create(name, number);
  }
  const base = origin(); const token = webhookToken(name);
  if (!base || !token) throw new EvolutionError("Webhook do WhatsApp não configurado.");
  await evolution.setWebhook(name, `${base}/api/webhooks/evolution/leads`, token, WEBHOOK_EVENTS);
  const result = await evolution.connect(name, number);
  if (number && !result.pairingCode) throw new EvolutionError("O WhatsApp não gerou o código agora. Tente o QR Code ou tente de novo em instantes.");
  return { connected: false as const, qr: number ? null : result.qr, pairingCode: number ? result.pairingCode : null };
}

async function removeInstance(evolution: EvolutionClient, name: string) {
  if (await evolution.instance(name)) {
    await evolution.logout(name).catch(() => undefined);
    try { await evolution.remove(name); } catch (error) { if (!(error instanceof EvolutionError && error.status === 404)) throw error; }
  }
}

/** Desconecta o número do cliente (a configuração e os leads já recebidos ficam). */
export async function disconnectLeadWaSession(service: Service, clientId: string) {
  const evolution = client();
  const session = await findSession(service, clientId);
  if (!evolution || !session) return;
  await removeInstance(evolution, leadInstanceName(session.id));
  await service.from("lead_whatsapp_sessions").update({ connected_phone: null, updated_at: new Date().toISOString() }).eq("id", session.id);
}

export async function updateLeadWaSettings(service: Service, input: { clientId: string; qualifyMode: LeadWaMode; ignoredNumbers: string[] }): Promise<boolean> {
  const { data, error } = await service.from("lead_whatsapp_sessions").update({ qualify_mode: input.qualifyMode, ignored_numbers: cleanIgnoredNumbers(input.ignoredNumbers), updated_at: new Date().toISOString() }).eq("client_id", input.clientId).select("id");
  return !error && (data?.length ?? 0) > 0;
}
