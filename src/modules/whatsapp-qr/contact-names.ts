import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { canonicalQrPeers } from "./peer-identity";

/** Only saved-contact app-state names, never profile push names, identify the agenda name. */
export function parseQrContactNames(body: unknown): Array<{ remoteId: string; name: string }> {
  const payload = body as { event?: unknown; data?: unknown } | null;
  if (payload?.event !== "contacts.upsert" && payload?.event !== "CONTACTS_UPSERT") return [];
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
  const names = new Map<string, string>();
  for (const row of rows.slice(0, 1000)) {
    const item = row as { remoteJid?: unknown; igrowSavedName?: unknown } | null;
    if (typeof item?.remoteJid !== "string" || !/^\d{8,20}@(s\.whatsapp\.net|lid)$/.test(item.remoteJid)) continue;
    if (typeof item.igrowSavedName !== "string" || !item.igrowSavedName.trim() || item.igrowSavedName.length > 200 || /[\x00-\x1f\x7f]/.test(item.igrowSavedName)) continue;
    names.set(item.remoteJid, item.igrowSavedName.trim());
  }
  return [...names].map(([remoteId, name]) => ({ remoteId, name }));
}

export async function syncQrContactNames(service: SupabaseClient<Database>, agencyId: string, epoch: string | undefined, body: unknown) {
  const names = parseQrContactNames(body);
  const aliases = await canonicalQrPeers(service, agencyId, epoch, names.map(item => item.remoteId));
  // Update only conversations that already exist. Do not import the address book or history.
  for (let offset = 0; offset < names.length; offset += 20) {
    const results = await Promise.all(names.slice(offset, offset + 20).map(item => service.from("whatsapp_conversations")
      .update({ title: item.name, updated_at: new Date().toISOString() }).eq("agency_id", agencyId).eq("channel", "qr")
      .eq("is_group", false).eq("remote_id", aliases.get(item.remoteId) ?? item.remoteId.replace("@s.whatsapp.net", ""))));
    if (results.some(result => result.error)) throw new Error("Falha ao sincronizar nomes de contatos do WhatsApp.");
  }
  return names.length;
}
