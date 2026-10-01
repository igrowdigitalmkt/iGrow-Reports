import "server-only";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUserSession } from "@/modules/agencies/context";
import type { Database } from "@/types/database";

export type ClientPortalAccess = {
  agencyId: string;
  client: {
    id: string;
    name: string;
    logoPath: string | null;
    archivedAt: string | null;
  };
};

export async function getClientPortalAccesses(
  supabase: SupabaseClient<Database>,
): Promise<ClientPortalAccess[]> {
  const { data, error } = await supabase.rpc("list_client_portal_clients", {});

  if (error) {
    throw new Error("Não foi possível consultar os acessos da Área do Cliente.");
  }

  return (data ?? []).map((client) => ({
    agencyId: client.agency_id,
    client: {
      id: client.id,
      name: client.name,
      logoPath: client.logo_path,
      archivedAt: client.archived_at,
    },
  }));
}

export async function requireClientPortalAccess(clientId: string) {
  const { supabase, user } = await requireUserSession(`/cliente/${clientId}`);
  const accesses = await getClientPortalAccesses(supabase);
  const selected = accesses.find(({ client }) => client.id === clientId);
  if (!selected) redirect("/cliente?estado=sem-acesso");
  return { supabase, user, access: selected, accesses };
}
