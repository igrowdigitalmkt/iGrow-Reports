import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

type Service = SupabaseClient<Database>;
export type QrPeerLink = { lid: string; phone: string };
const LID = /^\d{8,20}@lid$/;
const PHONE = /^\d{8,15}@s\.whatsapp\.net$/;

/** Only direct WhatsApp identity evidence can link a LID with a phone. */
export function qrPeerLinks(body: unknown): QrPeerLink[] {
  const payload = body as { data?: unknown } | null;
  const rows = Array.isArray(payload?.data) ? payload.data : payload?.data && typeof payload.data === "object" ? [payload.data] : [];
  const links = new Map<string, string>();
  for (const row of rows.slice(0, 30)) {
    const item = row as { key?: Record<string, unknown>; remoteJid?: unknown; remoteJidAlt?: unknown };
    if (!item || typeof item !== "object") continue;
    const key: Record<string, unknown> = item.key ?? (item as Record<string, unknown>);
    const lid = [key.remoteJid, key.lidJid, key.remoteJidAlt].find((value): value is string =>
      typeof value === "string" && LID.test(value));
    const phone = [key.remoteJid, key.remoteJidAlt, key.senderPn].find((value): value is string =>
      typeof value === "string" && PHONE.test(value));
    if (lid && phone) links.set(lid, phone);
  }
  return [...links].map(([lid,phone]) => ({lid,phone}));
}

/** Bind and merge proven aliases before storing any message/chat state. */
export async function bindQrPeerLinks(service: Service, agencyId: string, links: QrPeerLink[]) {
  if (!links.length) return;
  const { error } = await service.rpc("bind_whatsapp_qr_peer_links", { p_agency_id: agencyId, p_pairs: links as unknown as Json });
  if (error) throw new Error("Falha ao reconciliar os identificadores de contatos do WhatsApp.");
}

/** Read only peer links in this exact QR pairing; a reset invalidates prior aliases. */
export async function canonicalQrPeers(
  service: Service, agencyId: string, epoch: string | undefined, remoteIds: string[],
): Promise<Map<string,string>> {
  const lids = [...new Set(remoteIds.filter(id => LID.test(id)))];
  if (!lids.length || !epoch) return new Map();
  const { data, error } = await service.from("whatsapp_qr_peer_links")
    .select("lid,phone").eq("agency_id",agencyId).eq("session_epoch",epoch).in("lid",lids);
  if (error) throw new Error("Falha ao consultar identificadores do WhatsApp.");
  return new Map((data ?? []).map(item => [item.lid,item.phone]));
}
