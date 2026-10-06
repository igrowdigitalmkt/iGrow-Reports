import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { TemplatesSnapshot } from "./types";

// Saved message templates of the workspace, under the user's RLS. Before the templates migration
// is applied the table does not exist: only the platform's ready-made templates are offered.
export async function loadMessageTemplates(supabase: SupabaseClient<Database>, agencyId: string): Promise<TemplatesSnapshot> {
  const { data, error } = await supabase.from("message_templates").select("id,name,segment,body,updated_at").eq("agency_id", agencyId).order("name");
  if (error || !data) return { ready: false, items: [] };
  return { ready: true, items: data.map(row => ({ id: row.id, name: row.name, segment: row.segment, body: row.body, updatedAt: row.updated_at })) };
}
