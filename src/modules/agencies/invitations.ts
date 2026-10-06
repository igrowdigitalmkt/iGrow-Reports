import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Team invitations sent by e-mail are accepted as soon as the invited e-mail signs in (migration 202610070007).
export async function acceptPendingAgencyInvitations(supabase: SupabaseClient<Database>) {
  await supabase.rpc("accept_pending_agency_invitations").then(() => undefined, () => undefined);
}
