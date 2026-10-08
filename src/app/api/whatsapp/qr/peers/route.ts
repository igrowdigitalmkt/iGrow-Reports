import { requireAgencyContext } from "@/modules/agencies/context";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { qrResolvePeerLinks } from "@/modules/whatsapp-qr/server";
import { qrPeerLinks } from "@/modules/whatsapp-qr/peer-identity";

export const runtime = "nodejs";
export const maxDuration = 30;

// One small reconciliation when the inbox opens. Never guesses identity by
// matching profile photos, names, or phone-number suffixes.
export async function POST() {
  const context = await requireAgencyContext();
  const service = createSupabaseServiceClient();
  if (!service) return Response.json({ error: "Indisponível." }, { status: 503 });
  const agencyId = context.agency.id;
  const { data: guard, error: guardError } = await service.from("whatsapp_qr_reset_guards")
    .select("blocked,fresh_after").eq("agency_id", agencyId).maybeSingle();
  if (guardError || !guard || guard.blocked) return Response.json({ merged: 0 });
  const { data: chats, error: chatsError } = await context.supabase.from("whatsapp_conversations")
    .select("remote_id").eq("agency_id", agencyId).eq("channel", "qr")
    .like("remote_id", "%@lid").limit(60);
  if (chatsError || !chats) return Response.json({ error: "Falha ao localizar conversas." }, { status: 503 });
  const lids = [...new Set(chats.map(chat => chat.remote_id).filter(value => /^\d{8,20}@lid$/.test(value)))];
  if (!lids.length) return Response.json({ merged: 0 });
  try {
    const pairResults = await qrResolvePeerLinks(agencyId, lids);
    const pairs = qrPeerLinks({ data: pairResults.map(item => ({
      remoteJid: item.lid, remoteJidAlt: item.phone,
    })) });
    if (!pairs.length) return Response.json({ merged: 0 });
    const { data: merged, error } = await service.rpc("bind_whatsapp_qr_peer_links", {
      p_agency_id: agencyId, p_pairs: pairs,
    });
    if (error) throw error;
    return Response.json({ merged: merged ?? 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Não foi possível reconciliar contatos agora." }, { status: 502 });
  }
}
