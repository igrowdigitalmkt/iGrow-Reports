import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Team invitations sent by e-mail are accepted as soon as the invited e-mail signs in (migration 202610070007).
// Never blocks signing in: any failure (including the function not existing yet) is ignored.
export async function acceptPendingAgencyInvitations(supabase: SupabaseClient<Database>) {
  try {
    await supabase.rpc("accept_pending_agency_invitations");
  } catch {
    // The invitation can still be accepted later from its link.
  }
}
