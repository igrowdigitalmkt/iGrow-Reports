import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** Conversas do WhatsApp com mensagens não lidas, para a bolinha do menu (arquivadas não contam, como no WhatsApp). Só conta: não traz linhas. */
export async function unreadConversationCount(supabase: SupabaseClient<Database>, agencyId: string): Promise<number> {
  const query = () => supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("agency_id", agencyId).gt("unread_count", 0);
  let { count, error } = await query().eq("archived", false);
  // Antes da migração 202610070014 não existe a coluna archived.
  if (error) ({ count, error } = await query());
  return error ? 0 : count ?? 0;
}
