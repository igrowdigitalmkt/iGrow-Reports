import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** QR history is linked to the phone's session, not kept forever in the workspace. */
export async function blockQrInbox(agencyId: string) {
  const service = createSupabaseServiceClient();
  if (!service) throw new Error("Banco indisponível.");
  const { error } = await service.rpc("begin_whatsapp_qr_reset", { p_agency_id: agencyId });
  if (error) throw new Error("Não foi possível bloquear a sessão anterior.");
}

export async function clearBlockedQrInbox(agencyId: string) {
  const service = createSupabaseServiceClient();
  if (!service) throw new Error("Banco indisponível.");
  let removed = 0;
  const started = performance.now();
  // 40 chat rows per transaction, never an unbounded SQL transaction on Free.
  for (let batch = 0; batch < 30 && performance.now() - started < 20_000; batch++) {
    const { data, error } = await service.rpc("clear_whatsapp_qr_history_batch", {
      p_agency_id: agencyId, p_batch_size: 40,
    });
    if (error || typeof data !== "number" || !Number.isInteger(data) || data < 0 || data > 40)
      throw new Error("Limpeza interrompida. Tente novamente para concluir.");
    removed += data;
    if (data < 40) return removed;
  }
  // Keep the inbox blocked until everything has been removed.
  throw new Error("Limpeza parcial. Tente novamente para concluir.");
}

export async function clearQrInboxForLostSession(agencyId: string) {
  await blockQrInbox(agencyId);
  return clearBlockedQrInbox(agencyId);
}

/** 404 is definitive; a temporary 'close' must never trigger this. */
export async function clearOrphanedQrInbox(agencyId: string) {
  const service = createSupabaseServiceClient();
  if (!service) return;
  const { data, error } = await service.from("whatsapp_conversations").select("id")
    .eq("agency_id", agencyId).eq("channel", "qr").limit(1);
  if (error || !data?.length) return;
  await clearQrInboxForLostSession(agencyId);
}
