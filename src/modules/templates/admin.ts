import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { TemplatesSnapshot } from "./types";

// Saved message templates of the workspace, under the user's RLS. Before the templates migration
// is applied the table does not exist: only the platform's ready-made templates are offered.
export async function loadMessageTemplates(supabase: SupabaseClient<Database>, agencyId: string): Promise<TemplatesSnapshot> {
  const { data, error } = await supabase.from("message_templates").select("*").eq("agency_id", agencyId).order("name");
  if (error || !data) return { ready: false, channelsReady: false, items: [] };
  // Before migration 202610070005 there is no channel column: every saved template is a WhatsApp text.
  const channelsReady = data.length === 0 ? await supabase.from("message_templates").select("channel").limit(1).then(result => !result.error) : "channel" in data[0];
  return { ready: true, channelsReady, items: data.map(row => ({ id: row.id, name: row.name, segment: row.segment, channel: row.channel ?? "whatsapp", subject: row.subject ?? null, body: row.body, updatedAt: row.updated_at })) };
}
