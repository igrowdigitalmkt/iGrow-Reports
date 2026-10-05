import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Turns pending client portal invitations for the signed-in, confirmed email
// into active access. Never blocks sign-in: failures leave invitations pending.
export async function acceptPendingClientInvitations(supabase: SupabaseClient<Database>): Promise<string[]> {
  try {
    const { data, error } = await supabase.rpc("accept_client_portal_invitations", {});
    return error ? [] : (data ?? []);
  } catch {
    return [];
  }
}
