import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaError } from "@/lib/supabase/schema";
import type { Database } from "@/types/database";
import type { ClientPortalAdminAccess } from "./types";

export type ClientPortalAdminSnapshot = {
  ready: boolean;
  accesses: ClientPortalAdminAccess[];
};

export async function getAgencyClientPortalAccesses(
  supabase: SupabaseClient<Database>,
  agencyId: string,
): Promise<ClientPortalAdminSnapshot> {
  const { data, error } = await supabase.rpc("list_agency_client_portal_accesses", {
    p_agency_id: agencyId,
  });
  if (error) {
    if (isMissingSchemaError(error)) return { ready: false, accesses: [] };
    throw new Error("Não foi possível consultar os acessos da Área do Cliente.");
  }
  return {
    ready: true,
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
