import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { Database } from "@/types/database";
import type { ClientPortalAdminAccess, ClientPortalPendingInvitation } from "./types";

export type ClientPortalAdminSnapshot = {
  ready: boolean;
  accesses: ClientPortalAdminAccess[];
  invitations: ClientPortalPendingInvitation[];
};

export async function getAgencyClientPortalAccesses(
  supabase: SupabaseClient<Database>,
  agencyId: string,
): Promise<ClientPortalAdminSnapshot> {
  const { data, error } = await supabase.rpc("list_agency_client_portal_accesses", {
    p_agency_id: agencyId,
  });
  if (error) {
    if (isMissingSchemaError(error)) return { ready: false, accesses: [], invitations: [] };
    throw new Error("Não foi possível consultar os acessos da Área do Cliente.");
  }
  // Invitations arrive with a later migration; without it the list stays empty.
  const invited = await supabase.rpc("list_client_portal_invitations", { p_agency_id: agencyId });
  if (invited.error && !isMissingSchemaError(invited.error)) {
    throw new Error("Não foi possível consultar os convites da Área do Cliente.");
  }
  const invitations = (invited.data ?? []).map((row) => ({
    id: row.id, clientId: row.client_id, email: row.email, createdAt: row.created_at, expiresAt: row.expires_at,
  }));
  return {
    ready: true,
    invitations,
    accesses: (data ?? []).map((row) => ({
      clientId: row.client_id,
      userId: row.user_id,
      email: row.email,
      active: row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}
