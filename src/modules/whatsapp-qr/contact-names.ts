import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { canonicalQrPeers } from "./peer-identity";

/** Saved names take priority; native business/profile names fill missing titles only. */
export function parseQrContactNames(body: unknown): Array<{ remoteId: string; name: string; aliases?: string[]; fallback?: boolean }> {
  const payload = body as { event?: unknown; data?: unknown } | null;
  if (!payload || !["contacts.upsert", "CONTACTS_UPSERT", "contacts.update", "CONTACTS_UPDATE"].includes(String(payload.event))) return [];
  const rows = Array.isArray(payload.data) ? payload.data : [payload.data];
  const names = new Map<string, { name: string; aliases?: string[]; fallback?: boolean }>();
  for (const row of rows.slice(0, 1000)) {
    const item = row as { remoteJid?: unknown; remoteJidAlt?: unknown; lidJid?: unknown; igrowSavedName?: unknown; igrowVerifiedName?: unknown; igrowProfileName?: unknown } | null;
    if (typeof item?.remoteJid !== "string" || !/^\d{8,20}@(s\.whatsapp\.net|lid)$/.test(item.remoteJid)) continue;
    const nativeName = item.igrowSavedName ?? item.igrowVerifiedName ?? item.igrowProfileName;
    if (typeof nativeName !== "string" || !nativeName.trim() || nativeName.length > 200 || /^[0-9]{8,20}$/.test(nativeName.trim()) || /[\x00-\x1f\x7f]/.test(nativeName)) continue;
    const aliases = [...new Set([item.remoteJidAlt, item.lidJid].filter((value): value is string =>
      typeof value === "string" && /^\d{8,20}@(s\.whatsapp\.net|lid)$/.test(value) && value !== item.remoteJid))];
    names.set(item.remoteJid, { name: nativeName.trim(), ...(aliases.length ? { aliases } : {}), ...(!item.igrowSavedName ? { fallback: true } : {}) });
  }
  return [...names].map(([remoteId, data]) => ({ remoteId, ...data }));
}

export async function syncQrContactNames(service: SupabaseClient<Database>, agencyId: string, epoch: string | undefined, body: unknown) {
  const names = parseQrContactNames(body);
  const aliases = await canonicalQrPeers(service, agencyId, epoch, names.map(item => item.remoteId));
  // Update only conversations that already exist. Do not import the address book or history.
  for (let offset = 0; offset < names.length; offset += 20) {
    const results = await Promise.all(names.slice(offset, offset + 20).map(item => {
      let query = service.from("whatsapp_conversations")
      .update({ title: item.name, updated_at: new Date().toISOString() }).eq("agency_id", agencyId).eq("channel", "qr")
      .eq("is_group", false).in("remote_id", [...new Set([item.remoteId, ...(item.aliases ?? []), aliases.get(item.remoteId)]
        .filter((value): value is string => !!value).map(value => value.replace("@s.whatsapp.net", "")))]);
      if (item.fallback) query = query.is("title", null);
      return query;
    }));
    if (results.some(result => result.error)) throw new Error("Falha ao sincronizar nomes de contatos do WhatsApp.");
  }
  return names.length;
}
